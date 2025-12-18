/**
 * Authentication module for Google Calendar MCP server.
 *
 * Features:
 * - Auto-popup OAuth flow when token is expired/missing
 * - Automatic token refresh using refresh_token
 * - Token stored securely in user's home directory
 * - Can be called as MCP tool for manual re-auth
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { OAuth2Client, Credentials } from 'google-auth-library';
import open from 'open';
import { DEFAULT_CREDENTIALS, SCOPES } from './credentials.js';

// Configuration
const CONFIG_DIR = path.join(process.env.HOME || '', 'Claude', '.security');
const TOKEN_FILE = path.join(CONFIG_DIR, 'gcal-token.json');
const CALLBACK_PORT = 3036;

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expiry_date?: number;
}

export interface AuthResult {
  client: OAuth2Client;
  isNewAuth: boolean;
}

/**
 * Ensures the config directory exists with secure permissions
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Loads stored token from disk
 */
export function loadStoredToken(): StoredToken | null {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, 'utf-8');
      return JSON.parse(data) as StoredToken;
    }
  } catch (error) {
    console.error('Error loading stored token:', error);
  }
  return null;
}

/**
 * Saves token to disk with secure permissions
 */
function saveToken(token: StoredToken): void {
  ensureConfigDir();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 });
  console.error(`Token saved to ${TOKEN_FILE}`);
}

/**
 * Clears stored token
 */
export function clearToken(): void {
  if (fs.existsSync(TOKEN_FILE)) {
    fs.unlinkSync(TOKEN_FILE);
    console.error('Token cleared');
  }
}

/**
 * Creates an OAuth2 client with the default credentials
 */
export function createOAuth2Client(): OAuth2Client {
  return new OAuth2Client(
    DEFAULT_CREDENTIALS.client_id,
    DEFAULT_CREDENTIALS.client_secret,
    DEFAULT_CREDENTIALS.redirect_uri
  );
}

/**
 * Checks if a token is expired or about to expire (within 5 minutes)
 */
function isTokenExpired(token: StoredToken): boolean {
  if (!token.expiry_date) {
    // No expiry date, assume it might be expired
    return true;
  }
  // Check if token expires within 5 minutes
  const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
  return token.expiry_date < fiveMinutesFromNow;
}

/**
 * Starts a local callback server to receive the OAuth code
 */
function startCallbackServer(authClient: OAuth2Client): Promise<Credentials> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', `http://localhost:${CALLBACK_PORT}`);

        if (url.pathname === '/oauth2callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                  <h1 style="color: #d93025;">Authentication Failed</h1>
                  <p>${error}</p>
                  <p>You can close this window and try again.</p>
                </body>
              </html>
            `);
            server.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                  <h1 style="color: #d93025;">Authentication Failed</h1>
                  <p>No authorization code received.</p>
                  <p>You can close this window and try again.</p>
                </body>
              </html>
            `);
            server.close();
            reject(new Error('No authorization code received'));
            return;
          }

          // Exchange code for tokens
          const { tokens } = await authClient.getToken(code);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #1a73e8;">Authentication Successful!</h1>
                <p>Google Calendar MCP has been authorized.</p>
                <p>You can close this window and return to Claude Code.</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `);

          server.close();
          resolve(tokens);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      } catch (error) {
        res.writeHead(500);
        res.end('Authentication failed');
        server.close();
        reject(error);
      }
    });

    server.listen(CALLBACK_PORT, () => {
      console.error(`OAuth callback server listening on port ${CALLBACK_PORT}`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${CALLBACK_PORT} is already in use. Please try again.`));
      } else {
        reject(err);
      }
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out. Please try again.'));
    }, 120000);
  });
}

/**
 * Performs the OAuth flow by opening browser and waiting for callback
 */
export async function performOAuthFlow(): Promise<StoredToken> {
  const authClient = createOAuth2Client();

  // Generate auth URL
  const authUrl = authClient.generateAuthUrl({
    access_type: 'offline', // Request refresh token
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh token
  });

  console.error('Opening browser for authentication...');
  console.error(`Auth URL: ${authUrl}`);

  // Start callback server first
  const tokenPromise = startCallbackServer(authClient);

  // Open browser
  await open(authUrl);

  // Wait for callback
  const credentials = await tokenPromise;

  // Save token
  const token: StoredToken = {
    access_token: credentials.access_token || '',
    refresh_token: credentials.refresh_token || undefined,
    scope: SCOPES.join(' '),
    token_type: credentials.token_type || 'Bearer',
    expiry_date: credentials.expiry_date ?? undefined,
  };

  saveToken(token);
  console.error('Authentication successful!');

  return token;
}

/**
 * Gets an authenticated OAuth2 client.
 *
 * This is the main entry point for authentication:
 * 1. Tries to load existing token
 * 2. If token exists and has refresh_token, sets up auto-refresh
 * 3. If token is expired/missing and autoPopup is true, opens browser
 * 4. Returns authenticated client
 *
 * @param autoPopup - If true, automatically opens browser for auth when needed
 */
export async function getAuthenticatedClient(autoPopup: boolean = true): Promise<AuthResult> {
  const authClient = createOAuth2Client();

  // Try to load existing token
  let token = loadStoredToken();
  let isNewAuth = false;

  if (token) {
    // Set the token on the client
    authClient.setCredentials(token);

    // If we have a refresh token and the access token is expired, try to refresh
    if (token.refresh_token && isTokenExpired(token)) {
      console.error('Token expired, attempting refresh...');
      try {
        const { credentials } = await authClient.refreshAccessToken();
        token = {
          ...token,
          access_token: credentials.access_token || token.access_token,
          expiry_date: credentials.expiry_date ?? undefined,
        };
        authClient.setCredentials(token);
        saveToken(token);
        console.error('Token refreshed successfully');
      } catch (refreshError) {
        console.error('Failed to refresh token:', refreshError);
        // Refresh failed, need to re-auth
        token = null;
      }
    }
  }

  // If no valid token and autoPopup is enabled, perform OAuth flow
  if (!token && autoPopup) {
    console.error('No valid token found, starting OAuth flow...');
    token = await performOAuthFlow();
    authClient.setCredentials(token);
    isNewAuth = true;
  } else if (!token) {
    throw new Error(
      'Google Calendar not authenticated. Use the authenticate tool or run: npm run auth'
    );
  }

  // Set up automatic token refresh
  authClient.on('tokens', (newTokens) => {
    console.error('Token refreshed automatically');
    const currentToken = loadStoredToken();
    if (currentToken) {
      const updatedToken: StoredToken = {
        ...currentToken,
        access_token: newTokens.access_token || currentToken.access_token,
        expiry_date: newTokens.expiry_date ?? undefined,
        refresh_token: newTokens.refresh_token || currentToken.refresh_token,
      };
      saveToken(updatedToken);
    }
  });

  return { client: authClient, isNewAuth };
}

/**
 * CLI entry point for manual authentication
 */
async function main() {
  console.log('Google Calendar MCP Authentication');
  console.log('==================================\n');

  try {
    const { client, isNewAuth } = await getAuthenticatedClient(true);

    if (isNewAuth) {
      console.log('\nAuthentication successful!');
    } else {
      console.log('\nUsing existing token.');
    }

    console.log(`Token stored at: ${TOKEN_FILE}`);

    // Verify the token works
    const { google } = await import('googleapis');
    const calendar = google.calendar({ version: 'v3', auth: client });
    const calendarList = await calendar.calendarList.list({ maxResults: 1 });
    console.log(`\nVerified: Found ${calendarList.data.items?.length || 0} calendar(s)`);
  } catch (error) {
    console.error('\nAuthentication failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
