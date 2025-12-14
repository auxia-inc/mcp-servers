#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { GmailClient } from './gmail-client.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Initialize the MCP server
const server = new Server(
  {
    name: 'gmail-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize Gmail client
const gmailClient = new GmailClient();

// Define available tools
const tools: Tool[] = [
  // ========== Core Read Operations ==========
  {
    name: 'list_messages',
    description: 'List Gmail messages with optional filters. Returns message summaries with sender, subject, snippet, and labels.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query (e.g., "from:user@example.com", "is:unread", "subject:hello", "after:2025/01/01")',
        },
        labelIds: {
          type: 'array',
          description: 'Filter by label IDs (e.g., ["INBOX"], ["SENT"], ["STARRED"])',
          items: { type: 'string' },
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of messages to return (default: 20, max: 100)',
          default: 20,
        },
        includeSpamTrash: {
          type: 'boolean',
          description: 'Include messages from SPAM and TRASH (default: false)',
          default: false,
        },
      },
    },
  },
  {
    name: 'get_message',
    description: 'Get full details of a specific Gmail message including body content',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The Gmail message ID',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'search_messages',
    description: 'Search Gmail messages using Gmail query syntax. Supports operators like from:, to:, subject:, is:unread, has:attachment, after:, before:, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query (same syntax as Gmail search box)',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
          default: 20,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_threads',
    description: 'List Gmail conversation threads',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query to filter threads',
        },
        labelIds: {
          type: 'array',
          description: 'Filter by label IDs',
          items: { type: 'string' },
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of threads to return (default: 10)',
          default: 10,
        },
      },
    },
  },
  {
    name: 'get_thread',
    description: 'Get all messages in a conversation thread',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'The Gmail thread ID',
        },
      },
      required: ['threadId'],
    },
  },

  // ========== Send Operations ==========
  {
    name: 'send_message',
    description: 'Send a new email message',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address(es), comma-separated for multiple',
        },
        subject: {
          type: 'string',
          description: 'Email subject line',
        },
        body: {
          type: 'string',
          description: 'Email body content',
        },
        cc: {
          type: 'string',
          description: 'CC recipients, comma-separated',
        },
        bcc: {
          type: 'string',
          description: 'BCC recipients, comma-separated',
        },
        isHtml: {
          type: 'boolean',
          description: 'If true, body is treated as HTML (default: false)',
          default: false,
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'reply_to_message',
    description: 'Reply to an existing email message (stays in the same thread)',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID to reply to',
        },
        body: {
          type: 'string',
          description: 'Reply body content',
        },
        replyAll: {
          type: 'boolean',
          description: 'If true, reply to all recipients (default: false)',
          default: false,
        },
        isHtml: {
          type: 'boolean',
          description: 'If true, body is treated as HTML (default: false)',
          default: false,
        },
      },
      required: ['messageId', 'body'],
    },
  },
  {
    name: 'forward_message',
    description: 'Forward an email message to another recipient',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID to forward',
        },
        to: {
          type: 'string',
          description: 'Recipient email address to forward to',
        },
        comment: {
          type: 'string',
          description: 'Optional comment to add above the forwarded message',
        },
      },
      required: ['messageId', 'to'],
    },
  },

  // ========== Draft Operations ==========
  {
    name: 'list_drafts',
    description: 'List all draft messages',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: {
          type: 'number',
          description: 'Maximum number of drafts to return (default: 20)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'get_draft',
    description: 'Get a specific draft message',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: {
          type: 'string',
          description: 'The draft ID',
        },
      },
      required: ['draftId'],
    },
  },
  {
    name: 'create_draft',
    description: 'Create a new draft message',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address(es)',
        },
        subject: {
          type: 'string',
          description: 'Email subject line',
        },
        body: {
          type: 'string',
          description: 'Email body content',
        },
        cc: {
          type: 'string',
          description: 'CC recipients, comma-separated',
        },
        bcc: {
          type: 'string',
          description: 'BCC recipients, comma-separated',
        },
        isHtml: {
          type: 'boolean',
          description: 'If true, body is treated as HTML',
          default: false,
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'update_draft',
    description: 'Update an existing draft message',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: {
          type: 'string',
          description: 'The draft ID to update',
        },
        to: {
          type: 'string',
          description: 'Recipient email address(es)',
        },
        subject: {
          type: 'string',
          description: 'Email subject line',
        },
        body: {
          type: 'string',
          description: 'Email body content',
        },
        cc: {
          type: 'string',
          description: 'CC recipients',
        },
        isHtml: {
          type: 'boolean',
          description: 'If true, body is treated as HTML',
          default: false,
        },
      },
      required: ['draftId', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'send_draft',
    description: 'Send an existing draft message',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: {
          type: 'string',
          description: 'The draft ID to send',
        },
      },
      required: ['draftId'],
    },
  },
  {
    name: 'delete_draft',
    description: 'Permanently delete a draft message',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: {
          type: 'string',
          description: 'The draft ID to delete',
        },
      },
      required: ['draftId'],
    },
  },

  // ========== Label Operations ==========
  {
    name: 'list_labels',
    description: 'List all Gmail labels (folders/categories)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_label',
    description: 'Get details of a specific label including message counts',
    inputSchema: {
      type: 'object',
      properties: {
        labelId: {
          type: 'string',
          description: 'The label ID (e.g., "INBOX", "SENT", "STARRED", or custom label ID)',
        },
      },
      required: ['labelId'],
    },
  },
  {
    name: 'create_label',
    description: 'Create a new Gmail label (folder)',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the new label',
        },
        messageListVisibility: {
          type: 'string',
          description: 'Show or hide in message list',
          enum: ['show', 'hide'],
        },
        labelListVisibility: {
          type: 'string',
          description: 'Show in label list, show if unread, or hide',
          enum: ['labelShow', 'labelShowIfUnread', 'labelHide'],
        },
        backgroundColor: {
          type: 'string',
          description: 'Background color hex (e.g., "#16a765")',
        },
        textColor: {
          type: 'string',
          description: 'Text color hex (e.g., "#ffffff")',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_label',
    description: 'Delete a Gmail label (cannot delete system labels)',
    inputSchema: {
      type: 'object',
      properties: {
        labelId: {
          type: 'string',
          description: 'The label ID to delete',
        },
      },
      required: ['labelId'],
    },
  },

  // ========== Message Organization ==========
  {
    name: 'modify_labels',
    description: 'Add or remove labels from a message',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID to modify',
        },
        addLabelIds: {
          type: 'array',
          description: 'Label IDs to add',
          items: { type: 'string' },
        },
        removeLabelIds: {
          type: 'array',
          description: 'Label IDs to remove',
          items: { type: 'string' },
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'archive_message',
    description: 'Archive a message (remove from INBOX)',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID to archive',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'unarchive_message',
    description: 'Move a message back to INBOX',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID to unarchive',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'trash_message',
    description: 'Move a message to trash',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID to trash',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'untrash_message',
    description: 'Remove a message from trash',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID to untrash',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'delete_message',
    description: 'Permanently delete a message (cannot be undone!)',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID to permanently delete',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'mark_as_read',
    description: 'Mark a message as read',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'mark_as_unread',
    description: 'Mark a message as unread',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'star_message',
    description: 'Star a message',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'unstar_message',
    description: 'Remove star from a message',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'mark_as_important',
    description: 'Mark a message as important',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'mark_as_not_important',
    description: 'Remove important marker from a message',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID',
        },
      },
      required: ['messageId'],
    },
  },

  // ========== Batch Operations ==========
  {
    name: 'batch_modify_labels',
    description: 'Add or remove labels from multiple messages at once',
    inputSchema: {
      type: 'object',
      properties: {
        messageIds: {
          type: 'array',
          description: 'Array of message IDs',
          items: { type: 'string' },
        },
        addLabelIds: {
          type: 'array',
          description: 'Label IDs to add to all messages',
          items: { type: 'string' },
        },
        removeLabelIds: {
          type: 'array',
          description: 'Label IDs to remove from all messages',
          items: { type: 'string' },
        },
      },
      required: ['messageIds'],
    },
  },
  {
    name: 'batch_delete',
    description: 'Permanently delete multiple messages (cannot be undone!)',
    inputSchema: {
      type: 'object',
      properties: {
        messageIds: {
          type: 'array',
          description: 'Array of message IDs to delete',
          items: { type: 'string' },
        },
      },
      required: ['messageIds'],
    },
  },

  // ========== Attachment & Profile ==========
  {
    name: 'get_attachment',
    description: 'Download an email attachment and save to local file',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The message ID containing the attachment',
        },
        attachmentId: {
          type: 'string',
          description: 'The attachment ID (from message attachments list)',
        },
        outputPath: {
          type: 'string',
          description: 'Optional: local path to save the file',
        },
        filename: {
          type: 'string',
          description: 'Optional: filename for the downloaded file',
        },
      },
      required: ['messageId', 'attachmentId'],
    },
  },
  {
    name: 'get_profile',
    description: 'Get Gmail profile info (email address, total messages/threads)',
    inputSchema: {
      type: 'object',
      properties: {},
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
      // ========== Core Read Operations ==========
      case 'list_messages': {
        const { query, labelIds, maxResults = 20, includeSpamTrash = false } = args as {
          query?: string;
          labelIds?: string[];
          maxResults?: number;
          includeSpamTrash?: boolean;
        };
        const result = await gmailClient.listMessages({
          query,
          labelIds,
          maxResults: Math.min(maxResults, 100),
          includeSpamTrash,
        });
        // Return simplified format for readability
        const simplified = result.messages.map(m => ({
          id: m.id,
          threadId: m.threadId,
          from: m.from,
          to: m.to,
          subject: m.subject,
          date: m.date,
          snippet: m.snippet,
          isUnread: m.isUnread,
          isStarred: m.isStarred,
          labels: m.labelIds,
          hasAttachments: (m.attachments?.length || 0) > 0,
        }));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ messages: simplified, nextPageToken: result.nextPageToken }, null, 2),
          }],
        };
      }

      case 'get_message': {
        const { messageId } = args as { messageId: string };
        const message = await gmailClient.getMessage(messageId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(message, null, 2),
          }],
        };
      }

      case 'search_messages': {
        const { query, maxResults = 20 } = args as { query: string; maxResults?: number };
        const messages = await gmailClient.searchMessages(query, Math.min(maxResults, 100));
        const simplified = messages.map(m => ({
          id: m.id,
          threadId: m.threadId,
          from: m.from,
          subject: m.subject,
          date: m.date,
          snippet: m.snippet,
          isUnread: m.isUnread,
        }));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(simplified, null, 2),
          }],
        };
      }

      case 'list_threads': {
        const { query, labelIds, maxResults = 10 } = args as {
          query?: string;
          labelIds?: string[];
          maxResults?: number;
        };
        const result = await gmailClient.listThreads({
          query,
          labelIds,
          maxResults: Math.min(maxResults, 50),
        });
        const simplified = result.threads.map(t => ({
          id: t.id,
          snippet: t.snippet,
          messageCount: t.messages.length,
          latestFrom: t.messages[t.messages.length - 1]?.from,
          latestSubject: t.messages[0]?.subject,
          latestDate: t.messages[t.messages.length - 1]?.date,
        }));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ threads: simplified, nextPageToken: result.nextPageToken }, null, 2),
          }],
        };
      }

      case 'get_thread': {
        const { threadId } = args as { threadId: string };
        const thread = await gmailClient.getThread(threadId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(thread, null, 2),
          }],
        };
      }

      // ========== Send Operations ==========
      case 'send_message': {
        const { to, subject, body, cc, bcc, isHtml = false } = args as {
          to: string;
          subject: string;
          body: string;
          cc?: string;
          bcc?: string;
          isHtml?: boolean;
        };
        const message = await gmailClient.sendMessage({ to, subject, body, cc, bcc, isHtml });
        return {
          content: [{
            type: 'text',
            text: `Message sent successfully!\n${JSON.stringify({
              id: message.id,
              threadId: message.threadId,
              to: message.to,
              subject: message.subject,
            }, null, 2)}`,
          }],
        };
      }

      case 'reply_to_message': {
        const { messageId, body, replyAll = false, isHtml = false } = args as {
          messageId: string;
          body: string;
          replyAll?: boolean;
          isHtml?: boolean;
        };
        const message = await gmailClient.replyToMessage(messageId, body, { replyAll, isHtml });
        return {
          content: [{
            type: 'text',
            text: `Reply sent successfully!\n${JSON.stringify({
              id: message.id,
              threadId: message.threadId,
              to: message.to,
              subject: message.subject,
            }, null, 2)}`,
          }],
        };
      }

      case 'forward_message': {
        const { messageId, to, comment } = args as {
          messageId: string;
          to: string;
          comment?: string;
        };
        const message = await gmailClient.forwardMessage(messageId, to, comment);
        return {
          content: [{
            type: 'text',
            text: `Message forwarded successfully!\n${JSON.stringify({
              id: message.id,
              threadId: message.threadId,
              to: message.to,
              subject: message.subject,
            }, null, 2)}`,
          }],
        };
      }

      // ========== Draft Operations ==========
      case 'list_drafts': {
        const { maxResults = 20 } = args as { maxResults?: number };
        const drafts = await gmailClient.listDrafts(maxResults);
        const simplified = drafts.map(d => ({
          id: d.id,
          to: d.message.to,
          subject: d.message.subject,
          snippet: d.message.snippet,
        }));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(simplified, null, 2),
          }],
        };
      }

      case 'get_draft': {
        const { draftId } = args as { draftId: string };
        const draft = await gmailClient.getDraft(draftId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(draft, null, 2),
          }],
        };
      }

      case 'create_draft': {
        const { to, subject, body, cc, bcc, isHtml = false } = args as {
          to: string;
          subject: string;
          body: string;
          cc?: string;
          bcc?: string;
          isHtml?: boolean;
        };
        const draft = await gmailClient.createDraft({ to, subject, body, cc, bcc, isHtml });
        return {
          content: [{
            type: 'text',
            text: `Draft created successfully!\n${JSON.stringify({
              id: draft.id,
              to: draft.message.to,
              subject: draft.message.subject,
            }, null, 2)}`,
          }],
        };
      }

      case 'update_draft': {
        const { draftId, to, subject, body, cc, isHtml = false } = args as {
          draftId: string;
          to: string;
          subject: string;
          body: string;
          cc?: string;
          isHtml?: boolean;
        };
        const draft = await gmailClient.updateDraft(draftId, { to, subject, body, cc, isHtml });
        return {
          content: [{
            type: 'text',
            text: `Draft updated successfully!\n${JSON.stringify({
              id: draft.id,
              to: draft.message.to,
              subject: draft.message.subject,
            }, null, 2)}`,
          }],
        };
      }

      case 'send_draft': {
        const { draftId } = args as { draftId: string };
        const message = await gmailClient.sendDraft(draftId);
        return {
          content: [{
            type: 'text',
            text: `Draft sent successfully!\n${JSON.stringify({
              id: message.id,
              to: message.to,
              subject: message.subject,
            }, null, 2)}`,
          }],
        };
      }

      case 'delete_draft': {
        const { draftId } = args as { draftId: string };
        await gmailClient.deleteDraft(draftId);
        return {
          content: [{
            type: 'text',
            text: `Draft ${draftId} deleted successfully`,
          }],
        };
      }

      // ========== Label Operations ==========
      case 'list_labels': {
        const labels = await gmailClient.listLabels();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(labels, null, 2),
          }],
        };
      }

      case 'get_label': {
        const { labelId } = args as { labelId: string };
        const label = await gmailClient.getLabel(labelId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(label, null, 2),
          }],
        };
      }

      case 'create_label': {
        const { name, messageListVisibility, labelListVisibility, backgroundColor, textColor } = args as {
          name: string;
          messageListVisibility?: 'show' | 'hide';
          labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
          backgroundColor?: string;
          textColor?: string;
        };
        const label = await gmailClient.createLabel(name, {
          messageListVisibility,
          labelListVisibility,
          backgroundColor,
          textColor,
        });
        return {
          content: [{
            type: 'text',
            text: `Label created successfully!\n${JSON.stringify(label, null, 2)}`,
          }],
        };
      }

      case 'delete_label': {
        const { labelId } = args as { labelId: string };
        await gmailClient.deleteLabel(labelId);
        return {
          content: [{
            type: 'text',
            text: `Label ${labelId} deleted successfully`,
          }],
        };
      }

      // ========== Message Organization ==========
      case 'modify_labels': {
        const { messageId, addLabelIds, removeLabelIds } = args as {
          messageId: string;
          addLabelIds?: string[];
          removeLabelIds?: string[];
        };
        const message = await gmailClient.modifyLabels(messageId, { addLabelIds, removeLabelIds });
        return {
          content: [{
            type: 'text',
            text: `Labels modified successfully. Current labels: ${message.labelIds?.join(', ')}`,
          }],
        };
      }

      case 'archive_message': {
        const { messageId } = args as { messageId: string };
        await gmailClient.archiveMessage(messageId);
        return {
          content: [{
            type: 'text',
            text: `Message ${messageId} archived successfully`,
          }],
        };
      }

      case 'unarchive_message': {
        const { messageId } = args as { messageId: string };
        await gmailClient.unarchiveMessage(messageId);
        return {
          content: [{
            type: 'text',
            text: `Message ${messageId} moved to inbox`,
          }],
        };
      }

      case 'trash_message': {
        const { messageId } = args as { messageId: string };
        await gmailClient.trashMessage(messageId);
        return {
          content: [{
            type: 'text',
            text: `Message ${messageId} moved to trash`,
          }],
        };
      }

      case 'untrash_message': {
        const { messageId } = args as { messageId: string };
        await gmailClient.untrashMessage(messageId);
        return {
          content: [{
            type: 'text',
            text: `Message ${messageId} restored from trash`,
          }],
        };
      }

      case 'delete_message': {
        const { messageId } = args as { messageId: string };
        await gmailClient.deleteMessage(messageId);
        return {
          content: [{
            type: 'text',
            text: `Message ${messageId} permanently deleted`,
          }],
        };
      }

      case 'mark_as_read': {
        const { messageId } = args as { messageId: string };
        await gmailClient.markAsRead(messageId);
        return {
          content: [{
            type: 'text',
            text: `Message ${messageId} marked as read`,
          }],
        };
      }

      case 'mark_as_unread': {
        const { messageId } = args as { messageId: string };
        await gmailClient.markAsUnread(messageId);
        return {
          content: [{
            type: 'text',
            text: `Message ${messageId} marked as unread`,
          }],
        };
      }

      case 'star_message': {
        const { messageId } = args as { messageId: string };
        await gmailClient.starMessage(messageId);
        return {
          content: [{
            type: 'text',
            text: `Message ${messageId} starred`,
          }],
        };
      }

      case 'unstar_message': {
        const { messageId } = args as { messageId: string };
        await gmailClient.unstarMessage(messageId);
        return {
          content: [{
            type: 'text',
            text: `Message ${messageId} unstarred`,
          }],
        };
      }

      case 'mark_as_important': {
        const { messageId } = args as { messageId: string };
        await gmailClient.markAsImportant(messageId);
        return {
          content: [{
            type: 'text',
            text: `Message ${messageId} marked as important`,
          }],
        };
      }

      case 'mark_as_not_important': {
        const { messageId } = args as { messageId: string };
        await gmailClient.markAsNotImportant(messageId);
        return {
          content: [{
            type: 'text',
            text: `Message ${messageId} marked as not important`,
          }],
        };
      }

      // ========== Batch Operations ==========
      case 'batch_modify_labels': {
        const { messageIds, addLabelIds, removeLabelIds } = args as {
          messageIds: string[];
          addLabelIds?: string[];
          removeLabelIds?: string[];
        };
        await gmailClient.batchModifyLabels(messageIds, { addLabelIds, removeLabelIds });
        return {
          content: [{
            type: 'text',
            text: `Labels modified for ${messageIds.length} messages`,
          }],
        };
      }

      case 'batch_delete': {
        const { messageIds } = args as { messageIds: string[] };
        await gmailClient.batchDelete(messageIds);
        return {
          content: [{
            type: 'text',
            text: `${messageIds.length} messages permanently deleted`,
          }],
        };
      }

      // ========== Attachment & Profile ==========
      case 'get_attachment': {
        const { messageId, attachmentId, outputPath, filename } = args as {
          messageId: string;
          attachmentId: string;
          outputPath?: string;
          filename?: string;
        };
        const buffer = await gmailClient.getAttachment(messageId, attachmentId);

        // Determine output path
        let filePath: string;
        if (outputPath) {
          filePath = outputPath;
        } else {
          const tempDir = os.tmpdir();
          filePath = path.join(tempDir, filename || `attachment_${attachmentId}`);
        }

        // Write to file
        fs.writeFileSync(filePath, buffer);

        return {
          content: [{
            type: 'text',
            text: `Attachment downloaded successfully.\nPath: ${filePath}\nSize: ${buffer.length} bytes`,
          }],
        };
      }

      case 'get_profile': {
        const profile = await gmailClient.getProfile();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(profile, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text',
        text: `Error: ${errorMessage}`,
      }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Gmail MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
