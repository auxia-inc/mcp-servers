#!/usr/bin/env node
/**
 * Auxia MCP Server
 *
 * An MCP server that connects to the Auxia Console,
 * enabling Claude to manage treatments, projects,
 * and other operations through natural language.
 *
 * Authentication:
 *   Option 1 (Recommended): Use bff_authenticate tool - opens browser to console OAuth
 *   Option 2: Manually set session cookie via bff_set_session_cookie tool
 *
 * Environment variables:
 *   - CONSOLE_URL: Console URL (default: https://console.auxia.io)
 *   - AUXIA_MCP_SESSION_COOKIE: Session cookie value (optional, overrides stored session)
 *   - AUXIA_MCP_CALLBACK_PORT: OAuth callback port (default: 8765)
 *
 * @packageDocumentation
 */

import { createServer } from './server.js';
import { EXTERNAL_TOOLS } from './tools/index.js';

// Export everything for external use
export * from './types.js';
export * from './auth.js';
export * from './bff-client.js';
export * from './server.js';
export * from './tools/index.js';

/**
 * Main entry point - starts the MCP server with external tools
 */
async function main(): Promise<void> {
  await createServer({
    name: 'auxia-mcp',
    version: '0.2.0',
    tools: EXTERNAL_TOOLS,
  });
}

// Run if executed directly (not imported as a library)
// In ESM, we check if this file is the entry point
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
