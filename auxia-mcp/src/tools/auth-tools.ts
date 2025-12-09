/**
 * Authentication-related MCP tools
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';
import { authenticateWithSession, clearSession } from '../auth.js';

/**
 * bff_authenticate tool - Opens browser for OAuth login
 */
const authenticateTool: Tool = {
  name: 'bff_authenticate',
  description:
    'Authenticate with Auxia Console using Google OAuth. Opens a browser window for sign-in. This is the recommended way to authenticate.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

async function handleAuthenticate(
  _args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const result = await authenticateWithSession();
  context.setSessionCookie(result.sessionCookie);
  context.setCurrentUser({
    email: result.credentials.email,
    name: result.credentials.name,
  });
  await context.initializeBFFClient();
  return {
    content: [
      {
        type: 'text',
        text: `Successfully authenticated as ${result.credentials.email} (${result.credentials.name})`,
      },
    ],
  };
}

/**
 * bff_logout tool - Clears stored session
 */
const logoutTool: Tool = {
  name: 'bff_logout',
  description: 'Log out and clear the stored session.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

async function handleLogout(
  _args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  clearSession();
  context.setSessionCookie('');
  context.setCurrentUser(null);
  const client = context.getBFFClient();
  if (client) {
    client.close();
    context.setBFFClient(null);
  }
  return {
    content: [
      {
        type: 'text',
        text: 'Logged out successfully. Session cleared.',
      },
    ],
  };
}

/**
 * bff_set_session_cookie tool - Manual cookie setup
 */
const setSessionCookieTool: Tool = {
  name: 'bff_set_session_cookie',
  description:
    'Manually set the session cookie for BFF authentication. Use this if automatic authentication is not available. To get the cookie: 1) Sign into console.auxia.io in your browser, 2) Open DevTools > Application > Cookies, 3) Copy the full cookie string for "__Secure-next-auth.session-token"',
  inputSchema: {
    type: 'object',
    properties: {
      cookie: {
        type: 'string',
        description: 'The session cookie value (e.g., "__Secure-next-auth.session-token=eyJ...")',
      },
    },
    required: ['cookie'],
  },
};

async function handleSetSessionCookie(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const cookie = args.cookie as string;
  if (!cookie) {
    throw new Error('Cookie value is required');
  }
  context.setSessionCookie(cookie);
  context.setCurrentUser(null); // Unknown user when manually setting cookie
  await context.initializeBFFClient();
  return {
    content: [
      {
        type: 'text',
        text: `Session cookie set successfully. You can now use BFF tools.`,
      },
    ],
  };
}

/**
 * bff_get_auth_status tool - Check authentication status
 */
const getAuthStatusTool: Tool = {
  name: 'bff_get_auth_status',
  description: 'Get the current authentication status and session information.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

async function handleGetAuthStatus(
  _args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const hasSession = !!context.getSessionCookie();
  const client = context.getBFFClient();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            authenticated: hasSession,
            user: context.getCurrentUser(),
            clientInitialized: !!client,
            activeProject: client?.getActiveProjectId() || null,
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Export all auth tools as ToolDefinitions
 */
export const authTools: ToolDefinition[] = [
  { tool: authenticateTool, handler: handleAuthenticate },
  { tool: logoutTool, handler: handleLogout },
  { tool: setSessionCookieTool, handler: handleSetSessionCookie },
  { tool: getAuthStatusTool, handler: handleGetAuthStatus },
];
