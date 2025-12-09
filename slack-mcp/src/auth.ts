#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import { DEFAULT_CREDENTIALS, SLACK_USER_SCOPES } from './credentials.js';

const TOKEN_PATH = process.env.SLACK_TOKEN_PATH ||
  path.join(process.env.HOME || '', 'Claude', '.security', 'slack-token.json');

const PORT = 3036;

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  authed_user?: {
    id: string;
    access_token: string;
    token_type: string;
    scope: string;
  };
  team?: {
    id: string;
    name: string;
  };
}

async function exchangeCodeForToken(code: string, credentials: typeof DEFAULT_CREDENTIALS): Promise<SlackOAuthResponse> {
  const params = new URLSearchParams({
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    code: code,
    redirect_uri: credentials.redirect_uri,
  });

  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  return response.json() as Promise<SlackOAuthResponse>;
}

async function authenticate() {
  try {
    // Use embedded credentials (can be overridden with env var or file)
    let credentials = DEFAULT_CREDENTIALS;

    const credentialsPath = process.env.SLACK_CREDENTIALS_PATH ||
      path.join(process.env.HOME || '', 'Claude', 'slack-credentials.json');

    if (fs.existsSync(credentialsPath)) {
      // Override with custom credentials if file exists
      credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    }

    // Check if credentials are configured
    if (credentials.client_id === 'YOUR_SLACK_CLIENT_ID') {
      console.error('\n=== Slack MCP Authentication ===\n');
      console.error('Error: Slack OAuth credentials not configured.');
      console.error('\nTo configure:');
      console.error('1. Go to https://api.slack.com/apps');
      console.error('2. Create a new app or select existing one');
      console.error('3. Under OAuth & Permissions, add redirect URL: http://localhost:3036/oauth2callback');
      console.error('4. Add User Token Scopes (see documentation)');
      console.error('5. Copy Client ID and Client Secret from Basic Information');
      console.error('6. Update src/credentials.ts with the values');
      console.error('7. Run: npm run build && npm run auth');
      process.exit(1);
    }

    // Build auth URL with user scopes
    const authUrl = new URL('https://slack.com/oauth/v2/authorize');
    authUrl.searchParams.set('client_id', credentials.client_id);
    authUrl.searchParams.set('user_scope', SLACK_USER_SCOPES.join(','));
    authUrl.searchParams.set('redirect_uri', credentials.redirect_uri);

    console.log('\n=== Slack MCP Authentication ===\n');
    console.log('Opening browser to authorize the application...');
    console.log('\nIf the browser does not open automatically, visit this URL:');
    console.log('\n', authUrl.toString(), '\n');

    // Start local server to receive callback
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', `http://${req.headers.host}`);

        if (url.pathname === '/oauth2callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<h1>Authorization denied</h1><p>Error: ${error}</p>`);
            console.error(`\nAuthorization denied: ${error}`);
            server.close();
            process.exit(1);
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Authentication successful!</h1><p>You can close this window and return to the terminal.</p>');

            // Exchange code for token
            console.log('Exchanging authorization code for token...');
            const tokenResponse = await exchangeCodeForToken(code, credentials);

            if (!tokenResponse.ok || !tokenResponse.authed_user) {
              console.error(`\nError: ${tokenResponse.error || 'Failed to get user token'}`);
              server.close();
              process.exit(1);
            }

            // Ensure .security directory exists
            const securityDir = path.dirname(TOKEN_PATH);
            if (!fs.existsSync(securityDir)) {
              fs.mkdirSync(securityDir, { recursive: true });
            }

            // Save token with user info
            const tokenData = {
              user_token: tokenResponse.authed_user.access_token,
              user_id: tokenResponse.authed_user.id,
              scopes: tokenResponse.authed_user.scope,
              team_id: tokenResponse.team?.id,
              team_name: tokenResponse.team?.name,
              created_at: new Date().toISOString(),
            };

            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenData, null, 2));

            console.log('\n✓ Authentication successful!');
            console.log(`Token saved to: ${TOKEN_PATH}`);
            console.log(`\nUser ID: ${tokenData.user_id}`);
            console.log(`Team: ${tokenData.team_name}`);
            console.log('\nYou can now use the Slack MCP server.');

            server.close();
            process.exit(0);
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h1>Error: No authorization code received</h1>');
            server.close();
            process.exit(1);
          }
        }
      } catch (error) {
        console.error('Error during authentication:', error);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>Error during authentication</h1>');
        server.close();
        process.exit(1);
      }
    });

    server.listen(PORT, () => {
      console.log(`Local server started on http://localhost:${PORT}`);
      console.log('Waiting for authorization...\n');

      // Try to open browser
      open(authUrl.toString()).catch(() => {
        console.log('Could not open browser automatically. Please open the URL manually.');
      });
    });

  } catch (error) {
    console.error('Authentication failed:', error);
    process.exit(1);
  }
}

authenticate();
