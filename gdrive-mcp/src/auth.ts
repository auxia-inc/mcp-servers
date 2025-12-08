#!/usr/bin/env node

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { URL } from 'url';
import open from 'open';

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
];

const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH ||
                       path.join(process.env.HOME || '', 'Claude', 'gdrive-credentials.json');
const tokenPath = process.env.GOOGLE_TOKEN_PATH ||
                 path.join(process.env.HOME || '', 'Claude', 'gdrive-token.json');

async function authenticate() {
  try {
    // Load credentials
    if (!fs.existsSync(credentialsPath)) {
      console.error(`Credentials file not found: ${credentialsPath}`);
      console.error('\nPlease create this file with your OAuth2 credentials:');
      console.error(JSON.stringify({
        client_id: 'YOUR_CLIENT_ID',
        client_secret: 'YOUR_CLIENT_SECRET',
        redirect_uri: 'http://localhost:3000/oauth2callback',
      }, null, 2));
      process.exit(1);
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));

    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri || 'http://localhost:3000/oauth2callback'
    );

    // Generate auth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    console.log('\n=== Google Drive MCP Authentication ===\n');
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

            // Save token
            fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));

            console.log('\n✓ Authentication successful!');
            console.log(`Token saved to: ${tokenPath}`);
            console.log('\nYou can now use the Google Drive MCP server.');

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

    server.listen(3000, () => {
      console.log('Local server started on http://localhost:3000');
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
