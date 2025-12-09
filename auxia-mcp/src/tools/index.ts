/**
 * Tool exports for Auxia MCP
 *
 * This module exports all tools and their handlers,
 * allowing external packages to extend the tool set.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

// Import tool modules
import { authTools } from './auth-tools.js';
import { projectTools } from './project-tools.js';
import { treatmentTools } from './treatment-tools.js';

/**
 * All external (public) tools
 * These are safe to expose to external users
 */
export const EXTERNAL_TOOLS: ToolDefinition[] = [
  ...authTools,
  ...projectTools,
  ...treatmentTools,
];

/**
 * Get just the Tool definitions (for MCP ListTools)
 */
export function getToolDefinitions(tools: ToolDefinition[]): Tool[] {
  return tools.map((t) => t.tool);
}

/**
 * Get a handler map for quick lookup
 */
export function getToolHandlers(tools: ToolDefinition[]): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  for (const { tool, handler } of tools) {
    handlers.set(tool.name, handler);
  }
  return handlers;
}

// Re-export individual tool modules for selective imports
export { authTools } from './auth-tools.js';
export { projectTools } from './project-tools.js';
export { treatmentTools } from './treatment-tools.js';

// Re-export types
export type { ToolDefinition, ToolHandler, ToolContext, ToolResult } from '../types.js';
