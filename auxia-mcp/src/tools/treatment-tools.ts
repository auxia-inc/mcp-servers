/**
 * Treatment-related MCP tools
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

/**
 * bff_list_treatments tool - List treatments in active project
 */
const listTreatmentsTool: Tool = {
  name: 'bff_list_treatments',
  description:
    'List treatments in the active project. Supports filtering by surface, treatment type, state, and text search. Use limit and offset for pagination.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of treatments to return (default: 50)',
      },
      offset: {
        type: 'number',
        description: 'Number of treatments to skip (default: 0)',
      },
      surface: {
        type: 'string',
        description: 'Filter by surface name (case-insensitive partial match)',
      },
      treatmentType: {
        type: 'string',
        description: 'Filter by treatment type name (case-insensitive partial match)',
      },
      state: {
        type: 'string',
        description: 'Filter by state (e.g., "LIVE", "DRAFT")',
      },
      search: {
        type: 'string',
        description: 'Search in treatment name, type, tags, and objectives (case-insensitive)',
      },
      includeArchived: {
        type: 'boolean',
        description: 'Include archived treatments (default: false)',
      },
    },
    required: [],
  },
};

async function handleListTreatments(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const client = context.getBFFClient();
  if (!client) {
    throw new Error('Not authenticated. Use bff_authenticate first.');
  }

  // Extract includeArchived parameter (default: false)
  const includeArchived = (args.includeArchived as boolean) || false;

  // Fetch all treatments (BFF doesn't support server-side pagination/filtering beyond includeArchived)
  const allTreatments = await client.getTreatments({ includeArchived });

  // Extract filter parameters
  const surfaceFilter = args.surface as string | undefined;
  const treatmentTypeFilter = args.treatmentType as string | undefined;
  const stateFilter = args.state as string | undefined;
  const searchFilter = args.search as string | undefined;

  // Apply MCP-layer filtering
  let filteredTreatments = allTreatments;

  if (surfaceFilter) {
    const surfaceLower = surfaceFilter.toLowerCase();
    filteredTreatments = filteredTreatments.filter(
      (t) => t.surfaces?.some((s) => s.toLowerCase().includes(surfaceLower))
    );
  }

  if (treatmentTypeFilter) {
    const typeLower = treatmentTypeFilter.toLowerCase();
    filteredTreatments = filteredTreatments.filter(
      (t) => t.treatmentTypeName?.toLowerCase().includes(typeLower)
    );
  }

  if (stateFilter) {
    const stateLower = stateFilter.toLowerCase();
    filteredTreatments = filteredTreatments.filter(
      (t) => t.state?.toLowerCase() === stateLower
    );
  }

  if (searchFilter) {
    const searchLower = searchFilter.toLowerCase();
    filteredTreatments = filteredTreatments.filter(
      (t) => t._searchText?.includes(searchLower)
    );
  }

  // Apply pagination after filtering
  const limit = (args.limit as number) || 50;
  const offset = (args.offset as number) || 0;
  const paginatedTreatments = filteredTreatments.slice(offset, offset + limit);

  // Strip internal _searchText field before returning
  const cleanedTreatments = paginatedTreatments.map(({ _searchText, ...rest }) => rest);

  // Build filters applied summary
  const filtersApplied: Record<string, string | boolean> = {};
  if (surfaceFilter) filtersApplied.surface = surfaceFilter;
  if (treatmentTypeFilter) filtersApplied.treatmentType = treatmentTypeFilter;
  if (stateFilter) filtersApplied.state = stateFilter;
  if (searchFilter) filtersApplied.search = searchFilter;
  if (includeArchived) filtersApplied.includeArchived = true;

  const summary = {
    totalCount: allTreatments.length,
    filteredCount: filteredTreatments.length,
    offset: offset,
    limit: limit,
    returnedCount: cleanedTreatments.length,
    hasMore: offset + limit < filteredTreatments.length,
    filtersApplied: Object.keys(filtersApplied).length > 0 ? filtersApplied : undefined,
    treatments: cleanedTreatments,
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(summary, null, 2),
      },
    ],
  };
}

/**
 * bff_get_treatment tool - Get treatment details by ID
 */
const getTreatmentTool: Tool = {
  name: 'bff_get_treatment',
  description:
    'Get details of a specific treatment by ID. Requires an active project to be set first.',
  inputSchema: {
    type: 'object',
    properties: {
      treatment_id: {
        type: 'string',
        description: 'The treatment ID to retrieve',
      },
    },
    required: ['treatment_id'],
  },
};

async function handleGetTreatment(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const client = context.getBFFClient();
  if (!client) {
    throw new Error('Not authenticated. Use bff_authenticate first.');
  }
  const treatmentId = args.treatment_id as string;
  const treatment = await client.getTreatment(treatmentId);
  if (!treatment) {
    return {
      content: [
        {
          type: 'text',
          text: `Treatment ${treatmentId} not found`,
        },
      ],
    };
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(treatment, null, 2),
      },
    ],
  };
}

/**
 * bff_list_treatment_types tool - List treatment types in active project
 */
const listTreatmentTypesTool: Tool = {
  name: 'bff_list_treatment_types',
  description:
    'List treatment types configured for the active project. Treatment types define categories like Push Notifications, In-App Messages, etc.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

async function handleListTreatmentTypes(
  _args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const client = context.getBFFClient();
  if (!client) {
    throw new Error('Not authenticated. Use bff_authenticate first.');
  }
  const types = await client.getTreatmentTypes();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(types, null, 2),
      },
    ],
  };
}

/**
 * bff_list_surfaces tool - List surfaces in active project
 */
const listSurfacesTool: Tool = {
  name: 'bff_list_surfaces',
  description:
    'List surfaces configured for the active project. Surfaces represent placement locations where treatments can be shown (e.g., home page banner, checkout popup).',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

async function handleListSurfaces(
  _args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const client = context.getBFFClient();
  if (!client) {
    throw new Error('Not authenticated. Use bff_authenticate first.');
  }
  const surfaces = await client.getSurfaces();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(surfaces, null, 2),
      },
    ],
  };
}

/**
 * bff_list_objectives tool - List objectives in active project
 */
const listObjectivesTool: Tool = {
  name: 'bff_list_objectives',
  description:
    'List objectives configured for the active project. Objectives define business goals that treatments try to optimize (e.g., increase purchases, improve engagement).',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

async function handleListObjectives(
  _args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const client = context.getBFFClient();
  if (!client) {
    throw new Error('Not authenticated. Use bff_authenticate first.');
  }
  const objectives = await client.getObjectives();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(objectives, null, 2),
      },
    ],
  };
}

/**
 * bff_list_data_fields tool - List data fields in active project
 */
const listDataFieldsTool: Tool = {
  name: 'bff_list_data_fields',
  description:
    'List data fields configured for the active project. Data fields represent user attributes and event-derived metrics that can be used in eligibility rules and targeting. Returns a summarized view with id, name, type, and description. Use limit and offset for pagination.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of data fields to return (default: 50)',
      },
      offset: {
        type: 'number',
        description: 'Number of data fields to skip (default: 0)',
      },
    },
    required: [],
  },
};

async function handleListDataFields(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const client = context.getBFFClient();
  if (!client) {
    throw new Error('Not authenticated. Use bff_authenticate first.');
  }
  const allDataFields = await client.getDataFields();

  // Apply pagination at the MCP layer since BFF doesn't support it
  const limit = (args.limit as number) || 50;
  const offset = (args.offset as number) || 0;
  const paginatedFields = allDataFields.slice(offset, offset + limit);

  const summary = {
    totalCount: allDataFields.length,
    offset: offset,
    limit: limit,
    returnedCount: paginatedFields.length,
    hasMore: offset + limit < allDataFields.length,
    dataFields: paginatedFields,
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(summary, null, 2),
      },
    ],
  };
}

/**
 * Export all treatment tools as ToolDefinitions
 */
export const treatmentTools: ToolDefinition[] = [
  { tool: listTreatmentsTool, handler: handleListTreatments },
  { tool: getTreatmentTool, handler: handleGetTreatment },
  { tool: listTreatmentTypesTool, handler: handleListTreatmentTypes },
  { tool: listSurfacesTool, handler: handleListSurfaces },
  { tool: listObjectivesTool, handler: handleListObjectives },
  { tool: listDataFieldsTool, handler: handleListDataFields },
];
