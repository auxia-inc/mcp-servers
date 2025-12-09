#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { GoogleDriveClient } from './drive-client.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Initialize the MCP server
const server = new Server(
  {
    name: 'gdrive-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize Google Drive client
const driveClient = new GoogleDriveClient();

// Define available tools
const tools: Tool[] = [
  {
    name: 'list_files',
    description: 'List files in Google Drive with optional search query',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "name contains \'LAMPWEB\'")',
        },
        folderId: {
          type: 'string',
          description: 'Folder ID to search within (optional)',
        },
        pageSize: {
          type: 'number',
          description: 'Number of results to return (default: 100, max: 1000)',
          default: 100,
        },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read content from a Google Drive file (Docs, Sheets, or plain text)',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The Google Drive file ID',
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for files by name or content in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        searchTerm: {
          type: 'string',
          description: 'Term to search for in file names',
        },
        mimeType: {
          type: 'string',
          description: 'Filter by MIME type (e.g., "application/vnd.google-apps.document")',
        },
      },
      required: ['searchTerm'],
    },
  },
  {
    name: 'get_file_revisions',
    description: 'List all version history/revisions for a Google Drive file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The Google Drive file ID',
        },
        pageSize: {
          type: 'number',
          description: 'Number of revisions to return (default: 100, max: 1000)',
          default: 100,
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'read_file_revision',
    description: 'Read content from a specific version/revision of a Google Drive file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The Google Drive file ID',
        },
        revisionId: {
          type: 'string',
          description: 'The revision ID to read',
        },
      },
      required: ['fileId', 'revisionId'],
    },
  },
  {
    name: 'compare_revisions',
    description: 'Compare two versions/revisions of a Google Drive file and show differences',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The Google Drive file ID',
        },
        revisionId1: {
          type: 'string',
          description: 'The first revision ID to compare',
        },
        revisionId2: {
          type: 'string',
          description: 'The second revision ID to compare',
        },
      },
      required: ['fileId', 'revisionId1', 'revisionId2'],
    },
  },
  // Phase 5: Comments & Collaboration
  {
    name: 'list_comments',
    description: 'List all comments on a Google Drive file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The Google Drive file ID',
        },
        includeDeleted: {
          type: 'boolean',
          description: 'Whether to include deleted comments (default: false)',
          default: false,
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'create_comment',
    description: 'Add a comment to a Google Drive file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The Google Drive file ID',
        },
        content: {
          type: 'string',
          description: 'The comment text',
        },
        quotedText: {
          type: 'string',
          description: 'Optional: text to quote in the comment',
        },
      },
      required: ['fileId', 'content'],
    },
  },
  {
    name: 'resolve_comment',
    description: 'Mark a comment as resolved on a Google Drive file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The Google Drive file ID',
        },
        commentId: {
          type: 'string',
          description: 'The comment ID to resolve',
        },
      },
      required: ['fileId', 'commentId'],
    },
  },
  {
    name: 'unresolve_comment',
    description: 'Mark a comment as unresolved on a Google Drive file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The Google Drive file ID',
        },
        commentId: {
          type: 'string',
          description: 'The comment ID to unresolve',
        },
      },
      required: ['fileId', 'commentId'],
    },
  },
  // Phase 6: Advanced Search
  {
    name: 'search_by_owner',
    description: 'Search for files owned by a specific user',
    inputSchema: {
      type: 'object',
      properties: {
        ownerEmail: {
          type: 'string',
          description: 'Email address of the file owner',
        },
        pageSize: {
          type: 'number',
          description: 'Number of results to return (default: 100, max: 1000)',
          default: 100,
        },
      },
      required: ['ownerEmail'],
    },
  },
  {
    name: 'search_by_date_range',
    description: 'Search for files modified within a date range',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Start date in ISO format (e.g., "2025-01-01T00:00:00Z")',
        },
        endDate: {
          type: 'string',
          description: 'Optional end date in ISO format',
        },
        pageSize: {
          type: 'number',
          description: 'Number of results to return (default: 100, max: 1000)',
          default: 100,
        },
      },
      required: ['startDate'],
    },
  },
  {
    name: 'search_starred',
    description: 'Search for starred files in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        pageSize: {
          type: 'number',
          description: 'Number of results to return (default: 100, max: 1000)',
          default: 100,
        },
      },
    },
  },
  {
    name: 'search_recent',
    description: 'Search for recently modified files',
    inputSchema: {
      type: 'object',
      properties: {
        daysBack: {
          type: 'number',
          description: 'Number of days to look back (default: 7)',
          default: 7,
        },
        pageSize: {
          type: 'number',
          description: 'Number of results to return (default: 100, max: 1000)',
          default: 100,
        },
      },
    },
  },
  {
    name: 'star_file',
    description: 'Star/favorite a file in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The Google Drive file ID to star',
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'unstar_file',
    description: 'Unstar/unfavorite a file in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The Google Drive file ID to unstar',
        },
      },
      required: ['fileId'],
    },
  },
  // Phase 2: Google Sheets Write
  {
    name: 'update_cell',
    description: 'Update a single cell in a Google Sheets spreadsheet',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: {
          type: 'string',
          description: 'The spreadsheet ID (from the URL)',
        },
        range: {
          type: 'string',
          description: 'Cell range in A1 notation (e.g., "Sheet1!A1" or "A1")',
        },
        value: {
          type: 'string',
          description: 'The value to write to the cell',
        },
      },
      required: ['spreadsheetId', 'range', 'value'],
    },
  },
  {
    name: 'append_row',
    description: 'Append a new row to the end of a Google Sheets spreadsheet',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: {
          type: 'string',
          description: 'The spreadsheet ID (from the URL)',
        },
        range: {
          type: 'string',
          description: 'Sheet name or range (e.g., "Sheet1" or "Sheet1!A:Z")',
        },
        values: {
          type: 'array',
          description: 'Array of values for the row',
          items: { type: 'string' },
        },
      },
      required: ['spreadsheetId', 'range', 'values'],
    },
  },
  {
    name: 'batch_update_cells',
    description: 'Update multiple cell ranges in a Google Sheets spreadsheet at once',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: {
          type: 'string',
          description: 'The spreadsheet ID (from the URL)',
        },
        updates: {
          type: 'array',
          description: 'Array of updates, each with range and values',
          items: {
            type: 'object',
            properties: {
              range: { type: 'string' },
              values: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
      required: ['spreadsheetId', 'updates'],
    },
  },
  {
    name: 'create_spreadsheet',
    description: 'Create a new Google Sheets spreadsheet',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The title of the new spreadsheet',
        },
        sheetTitles: {
          type: 'array',
          description: 'Optional: array of sheet names to create',
          items: { type: 'string' },
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_sheets',
    description: 'List all sheets (tabs) in a Google Sheets spreadsheet',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: {
          type: 'string',
          description: 'The spreadsheet ID (from the URL)',
        },
      },
      required: ['spreadsheetId'],
    },
  },
  {
    name: 'read_sheet',
    description: 'Read content from a specific sheet in a Google Sheets spreadsheet, or all sheets if sheetName not provided',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: {
          type: 'string',
          description: 'The spreadsheet ID (from the URL)',
        },
        sheetName: {
          type: 'string',
          description: 'Optional: Name of the sheet to read. If not provided, reads all sheets.',
        },
        range: {
          type: 'string',
          description: 'Optional: A1 notation range (e.g., "A1:D10"). If not provided, reads entire sheet.',
        },
      },
      required: ['spreadsheetId'],
    },
  },
  // Phase 3: File Management
  {
    name: 'create_file',
    description: 'Create a new file in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the file',
        },
        mimeType: {
          type: 'string',
          description: 'MIME type (e.g., "application/vnd.google-apps.document" for Docs, "text/plain" for text)',
        },
        content: {
          type: 'string',
          description: 'Optional: initial content for the file',
        },
        parentFolderId: {
          type: 'string',
          description: 'Optional: folder ID to create the file in',
        },
      },
      required: ['name', 'mimeType'],
    },
  },
  {
    name: 'upload_file',
    description: 'Upload a local file to Google Drive (supports binary files like docx, pdf, images, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        localPath: {
          type: 'string',
          description: 'The absolute path to the local file to upload',
        },
        name: {
          type: 'string',
          description: 'Optional: name for the file in Google Drive (defaults to local filename)',
        },
        parentFolderId: {
          type: 'string',
          description: 'Optional: folder ID to upload the file to',
        },
      },
      required: ['localPath'],
    },
  },
  {
    name: 'update_file_content',
    description: 'Update the content of an existing Google Drive file with a new local file. Keeps the same file ID and URL - useful for versioning.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The Google Drive file ID to update',
        },
        localPath: {
          type: 'string',
          description: 'The absolute path to the local file with new content',
        },
      },
      required: ['fileId', 'localPath'],
    },
  },
  {
    name: 'create_folder',
    description: 'Create a new folder in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the folder',
        },
        parentFolderId: {
          type: 'string',
          description: 'Optional: parent folder ID',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'move_file',
    description: 'Move a file to a different folder in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID to move',
        },
        newParentFolderId: {
          type: 'string',
          description: 'The destination folder ID',
        },
      },
      required: ['fileId', 'newParentFolderId'],
    },
  },
  {
    name: 'copy_file',
    description: 'Create a copy of a file in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID to copy',
        },
        newName: {
          type: 'string',
          description: 'Optional: name for the copied file',
        },
        parentFolderId: {
          type: 'string',
          description: 'Optional: folder ID for the copy',
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file from Google Drive (moves to trash)',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID to delete',
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'update_file_metadata',
    description: 'Update file metadata (name, description, etc.) in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID to update',
        },
        name: {
          type: 'string',
          description: 'Optional: new name for the file',
        },
        description: {
          type: 'string',
          description: 'Optional: new description for the file',
        },
        starred: {
          type: 'boolean',
          description: 'Optional: star/unstar the file',
        },
      },
      required: ['fileId'],
    },
  },
  // Phase 4: Sharing & Permissions
  {
    name: 'share_file',
    description: 'Share a file with a user via email',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID to share',
        },
        email: {
          type: 'string',
          description: 'Email address of the user to share with',
        },
        role: {
          type: 'string',
          description: 'Permission role: reader, commenter, or writer',
          enum: ['reader', 'commenter', 'writer'],
        },
        sendNotificationEmail: {
          type: 'boolean',
          description: 'Whether to send notification email (default: true)',
          default: true,
        },
      },
      required: ['fileId', 'email', 'role'],
    },
  },
  {
    name: 'get_permissions',
    description: 'List all permissions/sharing settings for a file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID',
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'update_permission',
    description: 'Update an existing permission on a file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID',
        },
        permissionId: {
          type: 'string',
          description: 'The permission ID to update',
        },
        role: {
          type: 'string',
          description: 'New role: reader, commenter, or writer',
          enum: ['reader', 'commenter', 'writer'],
        },
      },
      required: ['fileId', 'permissionId', 'role'],
    },
  },
  {
    name: 'delete_permission',
    description: 'Delete a permission from a file (remove sharing access)',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID',
        },
        permissionId: {
          type: 'string',
          description: 'The permission ID to delete (use get_permissions to find IDs)',
        },
      },
      required: ['fileId', 'permissionId'],
    },
  },
  {
    name: 'create_public_link',
    description: 'Create a public shareable link for a file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID',
        },
        role: {
          type: 'string',
          description: 'Permission level for public access (default: reader)',
          enum: ['reader', 'commenter', 'writer'],
          default: 'reader',
        },
      },
      required: ['fileId'],
    },
  },
  // Phase 7: File Metadata & Properties
  {
    name: 'get_file_metadata',
    description: 'Get detailed metadata for a file (without content)',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID',
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'set_custom_properties',
    description: 'Set custom key-value properties on a file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID',
        },
        properties: {
          type: 'object',
          description: 'Key-value pairs to set as custom properties',
        },
      },
      required: ['fileId', 'properties'],
    },
  },
  // Phase 8: Export Options
  {
    name: 'export_file',
    description: 'Export a Google Workspace file to a different format',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID to export',
        },
        mimeType: {
          type: 'string',
          description: 'Target MIME type (e.g., "application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")',
        },
      },
      required: ['fileId', 'mimeType'],
    },
  },
  {
    name: 'download_file',
    description: 'Download a file to a local path',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The file ID to download',
        },
        outputPath: {
          type: 'string',
          description: 'Optional: local path to save the file. If not provided, saves to temp directory.',
        },
      },
      required: ['fileId'],
    },
  },
  // Phase 9: Batch Operations
  {
    name: 'batch_read_files',
    description: 'Read content from multiple files at once',
    inputSchema: {
      type: 'object',
      properties: {
        fileIds: {
          type: 'array',
          description: 'Array of file IDs to read',
          items: { type: 'string' },
        },
      },
      required: ['fileIds'],
    },
  },
  {
    name: 'batch_get_metadata',
    description: 'Get metadata for multiple files at once',
    inputSchema: {
      type: 'object',
      properties: {
        fileIds: {
          type: 'array',
          description: 'Array of file IDs',
          items: { type: 'string' },
        },
      },
      required: ['fileIds'],
    },
  },
  // Phase 10: Shared Drives
  {
    name: 'list_shared_drives',
    description: 'List all shared drives (team drives) you have access to',
    inputSchema: {
      type: 'object',
      properties: {
        pageSize: {
          type: 'number',
          description: 'Number of results to return (default: 100, max: 100)',
          default: 100,
        },
      },
    },
  },
  {
    name: 'get_shared_drive',
    description: 'Get details about a specific shared drive',
    inputSchema: {
      type: 'object',
      properties: {
        driveId: {
          type: 'string',
          description: 'The shared drive ID',
        },
      },
      required: ['driveId'],
    },
  },
  {
    name: 'list_files_in_shared_drive',
    description: 'List files in a specific shared drive',
    inputSchema: {
      type: 'object',
      properties: {
        driveId: {
          type: 'string',
          description: 'The shared drive ID',
        },
        query: {
          type: 'string',
          description: 'Optional search query',
        },
        pageSize: {
          type: 'number',
          description: 'Number of results to return (default: 100, max: 1000)',
          default: 100,
        },
      },
      required: ['driveId'],
    },
  },
];

// Handle list_tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle call_tool request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_files': {
        const { query, folderId, pageSize = 100 } = args as {
          query?: string;
          folderId?: string;
          pageSize?: number;
        };
        const files = await driveClient.listFiles(query, folderId, pageSize);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(files, null, 2),
            },
          ],
        };
      }

      case 'read_file': {
        const { fileId } = args as { fileId: string };
        const content = await driveClient.readFile(fileId);
        return {
          content: [
            {
              type: 'text',
              text: content,
            },
          ],
        };
      }

      case 'search_files': {
        const { searchTerm, mimeType } = args as {
          searchTerm: string;
          mimeType?: string;
        };
        const files = await driveClient.searchFiles(searchTerm, mimeType);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(files, null, 2),
            },
          ],
        };
      }

      case 'get_file_revisions': {
        const { fileId, pageSize = 100 } = args as {
          fileId: string;
          pageSize?: number;
        };
        const revisions = await driveClient.getFileRevisions(fileId, pageSize);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(revisions, null, 2),
            },
          ],
        };
      }

      case 'read_file_revision': {
        const { fileId, revisionId } = args as {
          fileId: string;
          revisionId: string;
        };
        const content = await driveClient.readFileRevision(fileId, revisionId);
        return {
          content: [
            {
              type: 'text',
              text: content,
            },
          ],
        };
      }

      case 'compare_revisions': {
        const { fileId, revisionId1, revisionId2 } = args as {
          fileId: string;
          revisionId1: string;
          revisionId2: string;
        };
        const comparison = await driveClient.compareRevisions(
          fileId,
          revisionId1,
          revisionId2
        );
        return {
          content: [
            {
              type: 'text',
              text: comparison,
            },
          ],
        };
      }

      // Phase 5: Comments & Collaboration
      case 'list_comments': {
        const { fileId, includeDeleted = false } = args as {
          fileId: string;
          includeDeleted?: boolean;
        };
        const comments = await driveClient.listComments(fileId, includeDeleted);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(comments, null, 2),
            },
          ],
        };
      }

      case 'create_comment': {
        const { fileId, content, quotedText } = args as {
          fileId: string;
          content: string;
          quotedText?: string;
        };
        const comment = await driveClient.createComment(fileId, content, quotedText);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(comment, null, 2),
            },
          ],
        };
      }

      case 'resolve_comment': {
        const { fileId, commentId } = args as {
          fileId: string;
          commentId: string;
        };
        const comment = await driveClient.resolveComment(fileId, commentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(comment, null, 2),
            },
          ],
        };
      }

      case 'unresolve_comment': {
        const { fileId, commentId } = args as {
          fileId: string;
          commentId: string;
        };
        const comment = await driveClient.unresolveComment(fileId, commentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(comment, null, 2),
            },
          ],
        };
      }

      // Phase 6: Advanced Search
      case 'search_by_owner': {
        const { ownerEmail, pageSize = 100 } = args as {
          ownerEmail: string;
          pageSize?: number;
        };
        const files = await driveClient.searchByOwner(ownerEmail, pageSize);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(files, null, 2),
            },
          ],
        };
      }

      case 'search_by_date_range': {
        const { startDate, endDate, pageSize = 100 } = args as {
          startDate: string;
          endDate?: string;
          pageSize?: number;
        };
        const files = await driveClient.searchByDateRange(startDate, endDate, pageSize);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(files, null, 2),
            },
          ],
        };
      }

      case 'search_starred': {
        const { pageSize = 100 } = args as {
          pageSize?: number;
        };
        const files = await driveClient.searchStarred(pageSize);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(files, null, 2),
            },
          ],
        };
      }

      case 'search_recent': {
        const { daysBack = 7, pageSize = 100 } = args as {
          daysBack?: number;
          pageSize?: number;
        };
        const files = await driveClient.searchRecent(daysBack, pageSize);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(files, null, 2),
            },
          ],
        };
      }

      case 'star_file': {
        const { fileId } = args as { fileId: string };
        await driveClient.starFile(fileId);
        return {
          content: [
            {
              type: 'text',
              text: `File ${fileId} starred successfully`,
            },
          ],
        };
      }

      case 'unstar_file': {
        const { fileId } = args as { fileId: string };
        await driveClient.unstarFile(fileId);
        return {
          content: [
            {
              type: 'text',
              text: `File ${fileId} unstarred successfully`,
            },
          ],
        };
      }

      // Phase 2: Google Sheets Write
      case 'update_cell': {
        const { spreadsheetId, range, value } = args as {
          spreadsheetId: string;
          range: string;
          value: string;
        };
        const result = await driveClient.updateCell(spreadsheetId, range, value);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'append_row': {
        const { spreadsheetId, range, values } = args as {
          spreadsheetId: string;
          range: string;
          values: string[];
        };
        const result = await driveClient.appendRow(spreadsheetId, range, values);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'batch_update_cells': {
        const { spreadsheetId, updates } = args as {
          spreadsheetId: string;
          updates: Array<{ range: string; values: string[][] }>;
        };
        const result = await driveClient.batchUpdateCells(spreadsheetId, updates);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'create_spreadsheet': {
        const { title, sheetTitles } = args as {
          title: string;
          sheetTitles?: string[];
        };
        const result = await driveClient.createSpreadsheet(title, sheetTitles);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list_sheets': {
        const { spreadsheetId } = args as {
          spreadsheetId: string;
        };
        const result = await driveClient.listSheets(spreadsheetId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'read_sheet': {
        const { spreadsheetId, sheetName, range } = args as {
          spreadsheetId: string;
          sheetName?: string;
          range?: string;
        };
        const result = await driveClient.readSheet(spreadsheetId, sheetName, range);
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      }

      // Phase 3: File Management
      case 'create_file': {
        const { name, mimeType, content, parentFolderId } = args as {
          name: string;
          mimeType: string;
          content?: string;
          parentFolderId?: string;
        };
        const result = await driveClient.createFile(name, mimeType, content, parentFolderId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'upload_file': {
        const { localPath, name, parentFolderId } = args as {
          localPath: string;
          name?: string;
          parentFolderId?: string;
        };
        const result = await driveClient.uploadFile(localPath, name, parentFolderId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'update_file_content': {
        const { fileId, localPath } = args as {
          fileId: string;
          localPath: string;
        };
        const result = await driveClient.updateFileContent(fileId, localPath);
        return {
          content: [
            {
              type: 'text',
              text: `File content updated successfully.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'create_folder': {
        const { name, parentFolderId } = args as {
          name: string;
          parentFolderId?: string;
        };
        const result = await driveClient.createFolder(name, parentFolderId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'move_file': {
        const { fileId, newParentFolderId } = args as {
          fileId: string;
          newParentFolderId: string;
        };
        const result = await driveClient.moveFile(fileId, newParentFolderId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'copy_file': {
        const { fileId, newName, parentFolderId } = args as {
          fileId: string;
          newName?: string;
          parentFolderId?: string;
        };
        const result = await driveClient.copyFile(fileId, newName, parentFolderId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_file': {
        const { fileId } = args as { fileId: string };
        await driveClient.deleteFile(fileId);
        return {
          content: [
            {
              type: 'text',
              text: `File ${fileId} deleted successfully`,
            },
          ],
        };
      }

      case 'update_file_metadata': {
        const { fileId, name, description, starred } = args as {
          fileId: string;
          name?: string;
          description?: string;
          starred?: boolean;
        };
        const result = await driveClient.updateFileMetadata(fileId, {
          name,
          description,
          starred,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Phase 4: Sharing & Permissions
      case 'share_file': {
        const { fileId, email, role, sendNotificationEmail = true } = args as {
          fileId: string;
          email: string;
          role: 'reader' | 'commenter' | 'writer';
          sendNotificationEmail?: boolean;
        };
        const result = await driveClient.shareFile(fileId, email, role, sendNotificationEmail);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_permissions': {
        const { fileId } = args as { fileId: string };
        const permissions = await driveClient.getPermissions(fileId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(permissions, null, 2),
            },
          ],
        };
      }

      case 'update_permission': {
        const { fileId, permissionId, role } = args as {
          fileId: string;
          permissionId: string;
          role: 'reader' | 'commenter' | 'writer';
        };
        const result = await driveClient.updatePermission(fileId, permissionId, role);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_permission': {
        const { fileId, permissionId } = args as {
          fileId: string;
          permissionId: string;
        };
        await driveClient.deletePermission(fileId, permissionId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, message: 'Permission deleted successfully' }, null, 2),
            },
          ],
        };
      }

      case 'create_public_link': {
        const { fileId, role = 'reader' } = args as {
          fileId: string;
          role?: 'reader' | 'commenter' | 'writer';
        };
        const result = await driveClient.createPublicLink(fileId, role);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Phase 7: File Metadata & Properties
      case 'get_file_metadata': {
        const { fileId } = args as { fileId: string };
        const metadata = await driveClient.getFileMetadata(fileId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(metadata, null, 2),
            },
          ],
        };
      }

      case 'set_custom_properties': {
        const { fileId, properties } = args as {
          fileId: string;
          properties: { [key: string]: string };
        };
        const result = await driveClient.setCustomProperties(fileId, properties);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Phase 8: Export Options
      case 'export_file': {
        const { fileId, mimeType } = args as {
          fileId: string;
          mimeType: string;
        };
        const content = await driveClient.exportFile(fileId, mimeType);
        return {
          content: [
            {
              type: 'text',
              text: content,
            },
          ],
        };
      }

      case 'download_file': {
        const { fileId, outputPath } = args as { fileId: string; outputPath?: string };
        const buffer = await driveClient.downloadFile(fileId);

        // Get file metadata to determine filename
        const metadata = await driveClient.getFileMetadata(fileId);
        const filename = metadata.name || `download_${fileId}`;

        // Determine output path
        let filePath: string;
        if (outputPath) {
          filePath = outputPath;
        } else {
          const tempDir = os.tmpdir();
          filePath = path.join(tempDir, filename);
        }

        // Write file to disk
        fs.writeFileSync(filePath, buffer);

        return {
          content: [
            {
              type: 'text',
              text: `File downloaded successfully.\nPath: ${filePath}\nSize: ${buffer.length} bytes`,
            },
          ],
        };
      }

      // Phase 9: Batch Operations
      case 'batch_read_files': {
        const { fileIds } = args as { fileIds: string[] };
        const results = await driveClient.batchReadFiles(fileIds);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'batch_get_metadata': {
        const { fileIds } = args as { fileIds: string[] };
        const results = await driveClient.batchGetMetadata(fileIds);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      // Phase 10: Shared Drives
      case 'list_shared_drives': {
        const { pageSize = 100 } = args as {
          pageSize?: number;
        };
        const drives = await driveClient.listSharedDrives(pageSize);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(drives, null, 2),
            },
          ],
        };
      }

      case 'get_shared_drive': {
        const { driveId } = args as { driveId: string };
        const drive = await driveClient.getSharedDrive(driveId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(drive, null, 2),
            },
          ],
        };
      }

      case 'list_files_in_shared_drive': {
        const { driveId, query, pageSize = 100 } = args as {
          driveId: string;
          query?: string;
          pageSize?: number;
        };
        const files = await driveClient.listFilesInSharedDrive(driveId, query, pageSize);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(files, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Google Drive MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
