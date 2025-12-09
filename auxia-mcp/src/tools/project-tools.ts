/**
 * Project-related MCP tools
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

/**
 * bff_list_projects tool - List all accessible projects
 */
const listProjectsTool: Tool = {
  name: 'bff_list_projects',
  description:
    'List all projects the authenticated user has access to. Returns project IDs and names.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

async function handleListProjects(
  _args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const client = context.getBFFClient();
  if (!client) {
    throw new Error('Not authenticated. Use bff_authenticate first.');
  }
  const projects = await client.getProjects();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(projects, null, 2),
      },
    ],
  };
}

/**
 * bff_set_active_project tool - Set the active project
 */
const setActiveProjectTool: Tool = {
  name: 'bff_set_active_project',
  description:
    'Set the active project for subsequent operations. Required before accessing project-specific data like treatments.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'The project ID to set as active',
      },
    },
    required: ['project_id'],
  },
};

async function handleSetActiveProject(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const client = context.getBFFClient();
  if (!client) {
    throw new Error('Not authenticated. Use bff_authenticate first.');
  }
  const projectId = args.project_id as string;
  client.setActiveProject(projectId);
  return {
    content: [
      {
        type: 'text',
        text: `Active project set to: ${projectId}`,
      },
    ],
  };
}

/**
 * Export all project tools as ToolDefinitions
 */
export const projectTools: ToolDefinition[] = [
  { tool: listProjectsTool, handler: handleListProjects },
  { tool: setActiveProjectTool, handler: handleSetActiveProject },
];
