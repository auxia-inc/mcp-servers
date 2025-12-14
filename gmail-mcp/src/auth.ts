#!/usr/bin/env node

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import { DEFAULT_CREDENTIALS } from './credentials.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
];

const tokenPath = process.env.GMAIL_TOKEN_PATH ||
                 path.join(process.env.HOME || '', 'Claude', '.security', 'gmail-token.json');

async function authenticate() {
  try {
    // Use embedded credentials (can be overridden with env var or file)
    let credentials = DEFAULT_CREDENTIALS;

    const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH ||
                           path.join(process.env.HOME || '', 'Claude', 'gmail-credentials.json');

    if (fs.existsSync(credentialsPath)) {
      // Override with custom credentials if file exists
      credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    }

    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri || 'http://localhost:3035/oauth2callback'
    );

    // Generate auth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force consent to get refresh token
    });

    console.log('\n=== Gmail MCP Authentication ===\n');
    console.log('Opening browser to authorize the application...');
    console.log('\nIf the browser does not open automatically, visit this URL:');
    console.log('\n', authUrl, '\n');

    // Start local server to receive callback
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', `http://${req.headers.host}`);

        if (url.pathname === '/oauth2callback') {
          const code = url.searchParams.get('code');

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Authentication successful!</h1><p>You can close this window and return to the terminal.</p>');

            // Exchange code for token
            const { tokens } = await oauth2Client.getToken(code);

            // Ensure .security directory exists
            const securityDir = path.dirname(tokenPath);
            if (!fs.existsSync(securityDir)) {
              fs.mkdirSync(securityDir, { recursive: true });
            }

            // Save token
            fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));

            console.log('\n✓ Authentication successful!');
            console.log(`Token saved to: ${tokenPath}`);
            console.log('\nYou can now use the Gmail MCP server.');

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

    server.listen(3035, () => {
      console.log('Local server started on http://localhost:3035');
      console.log('Waiting for authorization...\n');

      // Try to open browser
      open(authUrl).catch(() => {
        console.log('Could not open browser automatically. Please open the URL manually.');
      });
    });

  } catch (error) {
    console.error('Authentication failed:', error);
    process.exit(1);
  }
}

authenticate();
