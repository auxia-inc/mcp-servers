#!/usr/bin/env node

/**
 * Google Calendar MCP Server
 *
 * Features:
 * - Auto-popup OAuth when token is expired/missing (on startup)
 * - Automatic token refresh using refresh_token
 * - Manual re-auth via authenticate tool (no restart needed)
 * - Full Calendar API support: events, calendars, free/busy, etc.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { CalendarClient } from './calendar-client.js';
import { clearToken } from './auth.js';

// Initialize the MCP server
const server = new Server(
  {
    name: 'gcal-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize Calendar client (will auto-popup if needed)
const calendarClient = new CalendarClient();

// Define available tools
const tools: Tool[] = [
  // ========== Authentication ==========
  {
    name: 'authenticate',
    description:
      'Authenticate with Google Calendar. Opens browser for OAuth. Use this if you need to re-authenticate or switch accounts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'logout',
    description: 'Clear stored Google Calendar credentials. You will need to re-authenticate after this.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ========== Calendar List ==========
  {
    name: 'list_calendars',
    description: 'List all calendars the user has access to',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_calendar',
    description: 'Get details about a specific calendar',
    inputSchema: {
      type: 'object',
      properties: {
        calendarId: {
          type: 'string',
          description: 'The calendar ID (use "primary" for the main calendar)',
        },
      },
      required: ['calendarId'],
    },
  },

  // ========== Events ==========
  {
    name: 'list_events',
    description:
      'List events from a calendar. By default lists events from today onwards.',
    inputSchema: {
      type: 'object',
      properties: {
        calendarId: {
          type: 'string',
          description: 'Calendar ID (default: "primary")',
        },
        timeMin: {
          type: 'string',
          description: 'Start time in ISO format (default: now)',
        },
        timeMax: {
          type: 'string',
          description: 'End time in ISO format',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of events (default: 50)',
        },
        query: {
          type: 'string',
          description: 'Free text search query',
        },
        showDeleted: {
          type: 'boolean',
          description: 'Include deleted events',
        },
      },
    },
  },
  {
    name: 'get_event',
    description: 'Get details of a specific event',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'The event ID',
        },
        calendarId: {
          type: 'string',
          description: 'Calendar ID (default: "primary")',
        },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'create_event',
    description: 'Create a new calendar event',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Event title/summary',
        },
        description: {
          type: 'string',
          description: 'Event description',
        },
        location: {
          type: 'string',
          description: 'Event location',
        },
        startDateTime: {
          type: 'string',
          description:
            'Start date/time in ISO format (e.g., "2025-01-15T10:00:00-08:00")',
        },
        endDateTime: {
          type: 'string',
          description: 'End date/time in ISO format',
        },
        startDate: {
          type: 'string',
          description: 'For all-day events: start date in YYYY-MM-DD format',
        },
        endDate: {
          type: 'string',
          description: 'For all-day events: end date in YYYY-MM-DD format',
        },
        timeZone: {
          type: 'string',
          description: 'Time zone (e.g., "America/Los_Angeles")',
        },
        attendees: {
          type: 'array',
          description: 'List of attendee email addresses',
          items: { type: 'string' },
        },
        createMeetLink: {
          type: 'boolean',
          description: 'Create a Google Meet link for the event',
        },
        sendUpdates: {
          type: 'string',
          description: 'Send notifications: "all", "externalOnly", or "none"',
          enum: ['all', 'externalOnly', 'none'],
        },
        calendarId: {
          type: 'string',
          description: 'Calendar ID (default: "primary")',
        },
      },
      required: ['summary'],
    },
  },
  {
    name: 'update_event',
    description: 'Update an existing calendar event',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'The event ID to update',
        },
        summary: {
          type: 'string',
          description: 'New event title/summary',
        },
        description: {
          type: 'string',
          description: 'New event description',
        },
        location: {
          type: 'string',
          description: 'New event location',
        },
        startDateTime: {
          type: 'string',
          description: 'New start date/time in ISO format',
        },
        endDateTime: {
          type: 'string',
          description: 'New end date/time in ISO format',
        },
        startDate: {
          type: 'string',
          description: 'For all-day events: new start date in YYYY-MM-DD format',
        },
        endDate: {
          type: 'string',
          description: 'For all-day events: new end date in YYYY-MM-DD format',
        },
        timeZone: {
          type: 'string',
          description: 'Time zone',
        },
        attendees: {
          type: 'array',
          description: 'New list of attendee email addresses',
          items: { type: 'string' },
        },
        sendUpdates: {
          type: 'string',
          description: 'Send notifications: "all", "externalOnly", or "none"',
          enum: ['all', 'externalOnly', 'none'],
        },
        calendarId: {
          type: 'string',
          description: 'Calendar ID (default: "primary")',
        },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'delete_event',
    description: 'Delete a calendar event',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'The event ID to delete',
        },
        calendarId: {
          type: 'string',
          description: 'Calendar ID (default: "primary")',
        },
        sendUpdates: {
          type: 'string',
          description: 'Send notifications: "all", "externalOnly", or "none"',
          enum: ['all', 'externalOnly', 'none'],
        },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'quick_add_event',
    description:
      'Quickly add an event using natural language (e.g., "Meeting with John tomorrow at 3pm")',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'Natural language description of the event (e.g., "Team meeting tomorrow 2-3pm")',
        },
        calendarId: {
          type: 'string',
          description: 'Calendar ID (default: "primary")',
        },
        sendUpdates: {
          type: 'string',
          description: 'Send notifications: "all", "externalOnly", or "none"',
          enum: ['all', 'externalOnly', 'none'],
        },
      },
      required: ['text'],
    },
  },

  // ========== Search ==========
  {
    name: 'search_events',
    description: 'Search for events by text query',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        calendarId: {
          type: 'string',
          description: 'Calendar ID (default: "primary")',
        },
        timeMin: {
          type: 'string',
          description: 'Start time in ISO format',
        },
        timeMax: {
          type: 'string',
          description: 'End time in ISO format',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
        },
      },
      required: ['query'],
    },
  },

  // ========== Free/Busy ==========
  {
    name: 'get_free_busy',
    description: 'Get free/busy information for calendars',
    inputSchema: {
      type: 'object',
      properties: {
        timeMin: {
          type: 'string',
          description: 'Start time in ISO format',
        },
        timeMax: {
          type: 'string',
          description: 'End time in ISO format',
        },
        calendarIds: {
          type: 'array',
          description: 'List of calendar IDs (default: ["primary"])',
          items: { type: 'string' },
        },
        timeZone: {
          type: 'string',
          description: 'Time zone for the results',
        },
      },
      required: ['timeMin', 'timeMax'],
    },
  },

  // ========== RSVP ==========
  {
    name: 'respond_to_event',
    description: 'Respond to an event invitation (accept, decline, or tentative)',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'The event ID',
        },
        response: {
          type: 'string',
          description: 'Response: "accepted", "declined", or "tentative"',
          enum: ['accepted', 'declined', 'tentative'],
        },
        calendarId: {
          type: 'string',
          description: 'Calendar ID (default: "primary")',
        },
        sendUpdates: {
          type: 'string',
          description: 'Send notifications: "all", "externalOnly", or "none"',
          enum: ['all', 'externalOnly', 'none'],
        },
      },
      required: ['eventId', 'response'],
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
      // ========== Authentication ==========
      case 'authenticate': {
        const result = await calendarClient.authenticate();
        return {
          content: [
            {
              type: 'text',
              text: result.email
                ? `Authenticated successfully as ${result.email}`
                : 'Authenticated successfully',
            },
          ],
        };
      }

      case 'logout': {
        clearToken();
        return {
          content: [
            {
              type: 'text',
              text: 'Logged out. Credentials cleared. You will need to re-authenticate.',
            },
          ],
        };
      }

      // ========== Calendar List ==========
      case 'list_calendars': {
        const calendars = await calendarClient.listCalendars();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(calendars, null, 2),
            },
          ],
        };
      }

      case 'get_calendar': {
        const { calendarId } = args as { calendarId: string };
        const calendar = await calendarClient.getCalendar(calendarId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(calendar, null, 2),
            },
          ],
        };
      }

      // ========== Events ==========
      case 'list_events': {
        const {
          calendarId,
          timeMin,
          timeMax,
          maxResults,
          query,
          showDeleted,
        } = args as {
          calendarId?: string;
          timeMin?: string;
          timeMax?: string;
          maxResults?: number;
          query?: string;
          showDeleted?: boolean;
        };

        const events = await calendarClient.listEvents({
          calendarId,
          timeMin: timeMin || new Date().toISOString(),
          timeMax,
          maxResults,
          q: query,
          showDeleted,
        });

        // Format events for readability
        const formatted = events.map((e) => ({
          id: e.id,
          summary: e.summary || '(No title)',
          start: e.start.dateTime || e.start.date,
          end: e.end.dateTime || e.end.date,
          location: e.location,
          status: e.status,
          htmlLink: e.htmlLink,
          attendees: e.attendees?.length || 0,
          hasMeetLink: !!e.conferenceData?.entryPoints?.length,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      }

      case 'get_event': {
        const { eventId, calendarId } = args as {
          eventId: string;
          calendarId?: string;
        };
        const event = await calendarClient.getEvent(eventId, calendarId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(event, null, 2),
            },
          ],
        };
      }

      case 'create_event': {
        const {
          summary,
          description,
          location,
          startDateTime,
          endDateTime,
          startDate,
          endDate,
          timeZone,
          attendees,
          createMeetLink,
          sendUpdates,
          calendarId,
        } = args as {
          summary: string;
          description?: string;
          location?: string;
          startDateTime?: string;
          endDateTime?: string;
          startDate?: string;
          endDate?: string;
          timeZone?: string;
          attendees?: string[];
          createMeetLink?: boolean;
          sendUpdates?: 'all' | 'externalOnly' | 'none';
          calendarId?: string;
        };

        // Build start/end objects
        let start: { dateTime?: string; date?: string; timeZone?: string };
        let end: { dateTime?: string; date?: string; timeZone?: string };

        if (startDateTime) {
          start = { dateTime: startDateTime, timeZone };
          end = { dateTime: endDateTime || startDateTime, timeZone };
        } else if (startDate) {
          start = { date: startDate };
          end = { date: endDate || startDate };
        } else {
          // Default to 1 hour from now
          const now = new Date();
          const later = new Date(now.getTime() + 60 * 60 * 1000);
          start = { dateTime: now.toISOString() };
          end = { dateTime: later.toISOString() };
        }

        const event = await calendarClient.createEvent(
          {
            summary,
            description,
            location,
            start,
            end,
            attendees: attendees?.map((email) => ({ email })),
            createMeetLink,
            sendUpdates,
          },
          calendarId
        );

        const meetLink = event.conferenceData?.entryPoints?.find(
          (ep) => ep.entryPointType === 'video'
        )?.uri;

        return {
          content: [
            {
              type: 'text',
              text: `Event created successfully!\n${JSON.stringify(
                {
                  id: event.id,
                  summary: event.summary,
                  start: event.start.dateTime || event.start.date,
                  end: event.end.dateTime || event.end.date,
                  htmlLink: event.htmlLink,
                  meetLink,
                },
                null,
                2
              )}`,
            },
          ],
        };
      }

      case 'update_event': {
        const {
          eventId,
          summary,
          description,
          location,
          startDateTime,
          endDateTime,
          startDate,
          endDate,
          timeZone,
          attendees,
          sendUpdates,
          calendarId,
        } = args as {
          eventId: string;
          summary?: string;
          description?: string;
          location?: string;
          startDateTime?: string;
          endDateTime?: string;
          startDate?: string;
          endDate?: string;
          timeZone?: string;
          attendees?: string[];
          sendUpdates?: 'all' | 'externalOnly' | 'none';
          calendarId?: string;
        };

        const updates: any = {};
        if (summary) updates.summary = summary;
        if (description) updates.description = description;
        if (location) updates.location = location;

        if (startDateTime) {
          updates.start = { dateTime: startDateTime, timeZone };
        } else if (startDate) {
          updates.start = { date: startDate };
        }

        if (endDateTime) {
          updates.end = { dateTime: endDateTime, timeZone };
        } else if (endDate) {
          updates.end = { date: endDate };
        }

        if (attendees) {
          updates.attendees = attendees.map((email) => ({ email }));
        }

        const event = await calendarClient.updateEvent(
          eventId,
          updates,
          calendarId,
          sendUpdates
        );

        return {
          content: [
            {
              type: 'text',
              text: `Event updated successfully!\n${JSON.stringify(
                {
                  id: event.id,
                  summary: event.summary,
                  start: event.start.dateTime || event.start.date,
                  end: event.end.dateTime || event.end.date,
                  htmlLink: event.htmlLink,
                },
                null,
                2
              )}`,
            },
          ],
        };
      }

      case 'delete_event': {
        const { eventId, calendarId, sendUpdates } = args as {
          eventId: string;
          calendarId?: string;
          sendUpdates?: 'all' | 'externalOnly' | 'none';
        };
        await calendarClient.deleteEvent(eventId, calendarId, sendUpdates);
        return {
          content: [
            {
              type: 'text',
              text: `Event ${eventId} deleted successfully`,
            },
          ],
        };
      }

      case 'quick_add_event': {
        const { text, calendarId, sendUpdates } = args as {
          text: string;
          calendarId?: string;
          sendUpdates?: 'all' | 'externalOnly' | 'none';
        };
        const event = await calendarClient.quickAddEvent(
          text,
          calendarId,
          sendUpdates
        );
        return {
          content: [
            {
              type: 'text',
              text: `Event created!\n${JSON.stringify(
                {
                  id: event.id,
                  summary: event.summary,
                  start: event.start.dateTime || event.start.date,
                  end: event.end.dateTime || event.end.date,
                  htmlLink: event.htmlLink,
                },
                null,
                2
              )}`,
            },
          ],
        };
      }

      // ========== Search ==========
      case 'search_events': {
        const { query, calendarId, timeMin, timeMax, maxResults } = args as {
          query: string;
          calendarId?: string;
          timeMin?: string;
          timeMax?: string;
          maxResults?: number;
        };
        const events = await calendarClient.searchEvents(query, {
          calendarId,
          timeMin,
          timeMax,
          maxResults,
        });

        const formatted = events.map((e) => ({
          id: e.id,
          summary: e.summary || '(No title)',
          start: e.start.dateTime || e.start.date,
          end: e.end.dateTime || e.end.date,
          location: e.location,
          htmlLink: e.htmlLink,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      }

      // ========== Free/Busy ==========
      case 'get_free_busy': {
        const { timeMin, timeMax, calendarIds, timeZone } = args as {
          timeMin: string;
          timeMax: string;
          calendarIds?: string[];
          timeZone?: string;
        };
        const freeBusy = await calendarClient.getFreeBusy({
          timeMin,
          timeMax,
          calendarIds,
          timeZone,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(freeBusy, null, 2),
            },
          ],
        };
      }

      // ========== RSVP ==========
      case 'respond_to_event': {
        const { eventId, response, calendarId, sendUpdates } = args as {
          eventId: string;
          response: 'accepted' | 'declined' | 'tentative';
          calendarId?: string;
          sendUpdates?: 'all' | 'externalOnly' | 'none';
        };
        const event = await calendarClient.respondToEvent(
          eventId,
          response,
          calendarId,
          sendUpdates
        );
        return {
          content: [
            {
              type: 'text',
              text: `Response "${response}" recorded for event "${event.summary}"`,
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
  // Try to initialize the calendar client on startup
  // This will auto-popup OAuth if no valid token exists
  try {
    await calendarClient.ensureInitialized(true);
  } catch (error) {
    console.error('Warning: Could not initialize calendar client:', error);
    console.error('Use the "authenticate" tool to sign in.');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Google Calendar MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
