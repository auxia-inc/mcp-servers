/**
 * MCP Server factory for Auxia
 *
 * This module provides a factory function to create an MCP server
 * with a configurable set of tools. It can be used by:
 * - The main @auxia/mcp package (with external tools only)
 * - The @auxia/mcp-internal package (with external + internal tools)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type {
  ToolDefinition,
  ToolContext,
  BFFClientInterface,
  AuthCredentials,
} from './types.js';
import { getToolDefinitions, getToolHandlers } from './tools/index.js';
import { getCurrentSession } from './auth.js';
import { BFFClient } from './bff-client.js';

export interface ServerOptions {
  /** Server name shown to clients */
  name?: string;
  /** Server version */
  version?: string;
  /** Tools to register with the server */
  tools: ToolDefinition[];
}

export interface ServerState {
  sessionCookie: string;
  currentUser: { email: string; name: string } | null;
  bffClient: BFFClientInterface | null;
}

/**
 * Creates and starts an MCP server with the given tools
 */
export async function createServer(options: ServerOptions): Promise<void> {
  const {
    name = 'auxia-mcp',
    version = '0.2.0',
    tools,
  } = options;

  // Server state
  const state: ServerState = {
    sessionCookie: process.env.AUXIA_MCP_SESSION_COOKIE || '',
    currentUser: null,
    bffClient: null,
  };

  // Create tool context for handlers
  const context: ToolContext = {
    getSessionCookie: () => state.sessionCookie,
    setSessionCookie: (cookie: string) => {
      state.sessionCookie = cookie;
    },
    getCurrentUser: () => state.currentUser,
    setCurrentUser: (user) => {
      state.currentUser = user;
    },
    getBFFClient: () => state.bffClient,
    setBFFClient: (client) => {
      state.bffClient = client;
    },
    initializeBFFClient: async () => {
      if (!state.sessionCookie) {
        throw new Error('No session cookie set. Use bff_authenticate first.');
      }

      if (state.bffClient) {
        state.bffClient.close();
      }

      const credentials: AuthCredentials = {
        email: state.currentUser?.email || 'unknown',
        name: state.currentUser?.name || 'unknown',
        accessToken: '',
        expiresAt: Date.now() + 86400000,
      };

      state.bffClient = new BFFClient({
        credentials,
        sessionCookie: state.sessionCookie,
      });
    },
  };

  // Build handler map
  const handlers = getToolHandlers(tools);

  // Try to load existing session
  const existingSession = getCurrentSession();
  if (existingSession) {
    console.error(`Found existing session for ${existingSession.email}`);
    state.sessionCookie = `${existingSession.cookie_name}=${existingSession.session_cookie}`;
    state.currentUser = {
      email: existingSession.email,
      name: existingSession.name,
    };
    try {
      await context.initializeBFFClient();
      console.error('BFF client initialized from stored session');
    } catch (error) {
      console.error('Failed to initialize from stored session:', error);
      state.sessionCookie = '';
      state.currentUser = null;
    }
  } else if (state.sessionCookie) {
    console.error('Session cookie provided via environment variable');
    try {
      await context.initializeBFFClient();
      console.error('BFF client initialized from environment variable');
    } catch (error) {
      console.error('Failed to initialize BFF client:', error);
    }
  } else {
    console.error('No session found. Use bff_authenticate tool to sign in.');
  }

  // Create MCP server
  const server = new Server(
    { name, version },
    { capabilities: { tools: {} } }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: getToolDefinitions(tools) };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: args } = request.params;

    const handler = handlers.get(toolName);
    if (!handler) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${toolName}` }],
      };
    }

    try {
      const result = await handler(args || {}, context);
      return {
        content: result.content.map((c) => ({
          type: 'text' as const,
          text: c.text,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
      };
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`${name} server started (v${version})`);
}

// Re-export useful types and functions
export type { ToolDefinition, ToolContext, ToolHandler, ToolResult } from './types.js';
export { getToolDefinitions, getToolHandlers } from './tools/index.js';
