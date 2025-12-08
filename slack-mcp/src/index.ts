#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { SlackMessageClient } from './slack-client.js';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_USER_ID = process.env.SLACK_USER_ID;

if (!SLACK_BOT_TOKEN || !SLACK_USER_ID) {
  console.error('Error: SLACK_BOT_TOKEN and SLACK_USER_ID environment variables are required');
  process.exit(1);
}

const slackClient = new SlackMessageClient(SLACK_BOT_TOKEN, SLACK_USER_ID);

const TOOLS: Tool[] = [
  {
    name: 'search_messages',
    description: 'Search messages by query. Use query "<@USER_ID>" to find mentions. Supports filtering by channel type (all, public, private, dms, mpim).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "project update", "<@U123456>" for mentions)'
        },
        scope: {
          type: 'string',
          enum: ['all', 'public', 'private', 'dms', 'mpim'],
          description: 'Filter by channel type (default: all)',
          default: 'all'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages (default: 50)',
          default: 50
        },
        hoursAgo: {
          type: 'number',
          description: 'How many hours back to search (default: 24)',
          default: 24
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_messages',
    description: 'Get recent messages from channels. Can filter by channel type, specific channel, or DMs with a specific user (by email or name).',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Optional: specific channel ID'
        },
        channelType: {
          type: 'string',
          enum: ['all', 'public', 'private', 'dms', 'mpim'],
          description: 'Filter by channel type (default: all)',
          default: 'all'
        },
        userFilter: {
          type: 'string',
          description: 'Optional: email or name to get DMs with specific user'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages (default: 50)',
          default: 50
        },
        hoursAgo: {
          type: 'number',
          description: 'How many hours back (default: 24)',
          default: 24
        }
      }
    }
  },
  {
    name: 'list_channels',
    description: 'List channels. Use scope="member" for channels you are in, scope="all" for all workspace channels. Filter by type (public, private, dms, mpim).',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['member', 'all'],
          description: 'member = channels you are in, all = all workspace channels (default: member)',
          default: 'member'
        },
        type: {
          type: 'string',
          enum: ['all', 'public', 'private', 'dms', 'mpim'],
          description: 'Filter by channel type (default: all)',
          default: 'all'
        },
        search: {
          type: 'string',
          description: 'Optional: search string to filter by name'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of channels (default: 200)',
          default: 200
        }
      }
    }
  },
  {
    name: 'find_user',
    description: 'Find a Slack user by email, name, or user ID. Returns user info including ID, name, email, and title.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Email address, name, or user ID to search for'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'open_dm',
    description: 'Open a DM channel with a user by their user ID, email, or name. Returns the DM channel ID.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID (e.g., "U123456")'
        },
        email: {
          type: 'string',
          description: 'Email address of the user'
        },
        name: {
          type: 'string',
          description: 'Name of the user'
        }
      }
    }
  },
  {
    name: 'send_message',
    description: 'Send a message to a channel or DM. Can specify channelId directly, or provide userEmail/userName to automatically open a DM.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Channel ID to post to'
        },
        userEmail: {
          type: 'string',
          description: 'Alternative: email to auto-open DM and send message'
        },
        userName: {
          type: 'string',
          description: 'Alternative: name to auto-open DM and send message'
        },
        text: {
          type: 'string',
          description: 'Message text'
        },
        threadTs: {
          type: 'string',
          description: 'Optional: thread timestamp to reply in thread'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'add_reaction',
    description: 'Add an emoji reaction to a message.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Channel ID where the message is'
        },
        timestamp: {
          type: 'string',
          description: 'Message timestamp (ts field)'
        },
        emoji: {
          type: 'string',
          description: 'Emoji name without colons (e.g., "thumbsup", "eyes")'
        }
      },
      required: ['channelId', 'timestamp', 'emoji']
    }
  },
  {
    name: 'delete_message',
    description: 'Delete a message from a channel. Can only delete messages sent by the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Channel ID where the message is'
        },
        timestamp: {
          type: 'string',
          description: 'Message timestamp (ts field)'
        }
      },
      required: ['channelId', 'timestamp']
    }
  }
];

const server = new Server(
  {
    name: 'slack-message-manager',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_messages': {
        const messages = await slackClient.searchMessages({
          query: args?.query as string,
          scope: args?.scope as 'all' | 'public' | 'private' | 'dms' | 'mpim',
          limit: args?.limit as number,
          hoursAgo: args?.hoursAgo as number
        });

        return {
          content: [{ type: 'text', text: slackClient.formatMessagesCompact(messages) }]
        };
      }

      case 'get_messages': {
        const messages = await slackClient.getMessages({
          channelId: args?.channelId as string,
          channelType: args?.channelType as 'all' | 'public' | 'private' | 'dms' | 'mpim',
          userFilter: args?.userFilter as string,
          limit: args?.limit as number,
          hoursAgo: args?.hoursAgo as number
        });

        return {
          content: [{ type: 'text', text: slackClient.formatMessagesCompact(messages) }]
        };
      }

      case 'list_channels': {
        const channels = await slackClient.listChannels({
          scope: args?.scope as 'member' | 'all',
          type: args?.type as 'all' | 'public' | 'private' | 'dms' | 'mpim',
          search: args?.search as string,
          limit: args?.limit as number
        });

        return {
          content: [{ type: 'text', text: slackClient.formatChannelsCompact(channels) }]
        };
      }

      case 'find_user': {
        const user = await slackClient.findUser(args?.query as string);

        if (!user) {
          return {
            content: [{ type: 'text', text: `User not found for query: ${args?.query}` }]
          };
        }

        let result = `User found:\n`;
        result += `  ID: ${user.id}\n`;
        result += `  Username: @${user.name}\n`;
        result += `  Real Name: ${user.realName}\n`;
        if (user.email) result += `  Email: ${user.email}\n`;
        if (user.title) result += `  Title: ${user.title}\n`;

        return {
          content: [{ type: 'text', text: result }]
        };
      }

      case 'open_dm': {
        const dm = await slackClient.openDM({
          userId: args?.userId as string,
          email: args?.email as string,
          name: args?.name as string
        });

        if (!dm) {
          return {
            content: [{ type: 'text', text: 'Could not open DM channel. User not found.' }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: `DM Channel opened:\n  Channel ID: ${dm.channelId}\n  User ID: ${dm.userId}\n  User Name: ${dm.userName}`
          }]
        };
      }

      case 'send_message': {
        const result = await slackClient.sendMessage({
          channelId: args?.channelId as string,
          userEmail: args?.userEmail as string,
          userName: args?.userName as string,
          text: args?.text as string,
          threadTs: args?.threadTs as string
        });

        if (!result.success) {
          return {
            content: [{ type: 'text', text: `Failed to send message: ${result.error}` }],
            isError: true
          };
        }

        return {
          content: [{ type: 'text', text: `Message sent successfully to channel ${result.channelId}` }]
        };
      }

      case 'add_reaction': {
        await slackClient.addReaction(
          args?.channelId as string,
          args?.timestamp as string,
          args?.emoji as string
        );

        return {
          content: [{ type: 'text', text: 'Reaction added successfully' }]
        };
      }

      case 'delete_message': {
        const result = await slackClient.deleteMessage(
          args?.channelId as string,
          args?.timestamp as string
        );

        if (!result.success) {
          return {
            content: [{ type: 'text', text: `Failed to delete message: ${result.error}` }],
            isError: true
          };
        }

        return {
          content: [{ type: 'text', text: 'Message deleted successfully' }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Slack Message Manager MCP Server v2.0.0 running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
