/**
 * Authentication module for Auxia MCP server.
 *
 * Uses the Auxia Console's OAuth flow - no separate Google credentials needed.
 * Opens browser to console login, receives session token via local callback.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import open from 'open';
import type { AuthCredentials, StoredSession, AuthResult } from './types.js';

// Re-export types for consumers
export type { AuthCredentials, StoredSession, AuthResult };

// Configuration
const CONFIG_DIR = path.join(process.env.HOME || '', '.auxia-mcp');
const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');

// Console URL
const CONSOLE_URL = process.env.CONSOLE_URL || 'https://console.auxia.io';

// Callback port for receiving auth token
const CALLBACK_PORT = parseInt(process.env.AUXIA_MCP_CALLBACK_PORT || '8765');

/**
 * Ensures the config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Loads stored session from disk
 */
export function loadStoredSession(): StoredSession | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = fs.readFileSync(SESSION_FILE, 'utf-8');
      const session = JSON.parse(data) as StoredSession;
      // Check if session is expired
      if (new Date(session.expires_at) < new Date()) {
        console.error('Stored session has expired');
        return null;
      }
      return session;
    }
  } catch (error) {
    console.error('Error loading stored session:', error);
  }
  return null;
}

/**
 * Saves session to disk
 */
function saveSession(session: StoredSession): void {
  ensureConfigDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
}

/**
 * Clears stored session
 */
export function clearSession(): void {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
  }
}

/**
 * Gets current session if available (without prompting)
 */
export function getCurrentSession(): StoredSession | null {
  return loadStoredSession();
}

/**
 * Starts a local callback server to receive the auth token from console
 */
function startCallbackServer(): Promise<StoredSession> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', `http://localhost:${CALLBACK_PORT}`);

        if (url.pathname === '/callback') {
          const token = url.searchParams.get('token');
          const cookieName = url.searchParams.get('cookie_name');
          const email = url.searchParams.get('email');
          const name = url.searchParams.get('name');
          const error = url.searchParams.get('error');

          if (error) {
            const errorUrl = `${CONSOLE_URL}/mcp-auth?status=error&message=${encodeURIComponent(error)}`;
            res.writeHead(302, {
              'Location': errorUrl,
              'Content-Type': 'text/plain'
            });
            res.end(`Authentication failed: ${error}\n\nRedirecting to ${errorUrl}\n\nIf not redirected, please close this window and try again.`);
            server.close();
            reject(new Error(error));
            return;
          }

          if (!token || !cookieName || !email) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Authentication failed: Missing required parameters (token, cookie_name, or email).\n\nPlease close this window and try again.');
            server.close();
            reject(new Error('Missing token, cookie_name, or email in callback'));
            return;
          }

          // Calculate expiry (30 days from now)
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

          const session: StoredSession = {
            session_cookie: token,
            cookie_name: cookieName,
            expires_at: expiresAt,
            email: email,
            name: name || '',
          };

          // Save session
          saveSession(session);

          // Redirect to console success page
          const successUrl = `${CONSOLE_URL}/mcp-auth?status=success&email=${encodeURIComponent(email)}`;
          res.writeHead(302, {
            'Location': successUrl,
            'Content-Type': 'text/plain'
          });
          res.end(`Authentication successful!\n\nSigned in as: ${email}\n\nRedirecting to ${successUrl}\n\nIf not redirected, you can close this window and return to Claude Code.`);

          server.close();
          resolve(session);
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
      console.error(`Auth callback server listening on port ${CALLBACK_PORT}`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${CALLBACK_PORT} is already in use. Set AUXIA_MCP_CALLBACK_PORT to use a different port.`));
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
 * Performs full authentication flow via Auxia Console OAuth
 * This is the main entry point for MCP server authentication.
 */
export async function authenticateWithSession(): Promise<AuthResult> {
  // Check for existing valid session
  const existingSession = loadStoredSession();
  if (existingSession) {
    console.error(`Using existing session for ${existingSession.email}`);
    return {
      credentials: {
        email: existingSession.email,
        name: existingSession.name,
        accessToken: '',
        expiresAt: new Date(existingSession.expires_at).getTime(),
      },
      sessionCookie: `${existingSession.cookie_name}=${existingSession.session_cookie}`,
      cookieName: existingSession.cookie_name,
    };
  }

  // Start callback server first
  console.error('Starting authentication flow...');
  const sessionPromise = startCallbackServer();

  // Open browser to console's MCP login endpoint
  const loginUrl = `${CONSOLE_URL}/api/auth/mcp-login?port=${CALLBACK_PORT}`;
  console.error(`Opening browser to: ${loginUrl}`);
  await open(loginUrl);

  // Wait for callback
  const session = await sessionPromise;

  console.error(`Successfully authenticated as ${session.email}`);

  return {
    credentials: {
      email: session.email,
      name: session.name,
      accessToken: '',
      expiresAt: new Date(session.expires_at).getTime(),
    },
    sessionCookie: `${session.cookie_name}=${session.session_cookie}`,
    cookieName: session.cookie_name,
  };
}

// CLI for manual authentication
if (import.meta.url === `file://${process.argv[1]}`) {
  authenticateWithSession()
    .then((result) => {
      console.log('\nAuthentication successful!');
      console.log(`Email: ${result.credentials.email}`);
      console.log(`Name: ${result.credentials.name}`);
      console.log(`Session stored at: ${SESSION_FILE}`);
    })
    .catch((error) => {
      console.error('Authentication failed:', error);
      process.exit(1);
    });
}
