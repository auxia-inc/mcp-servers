# Google Calendar MCP Server

MCP server for Google Calendar with **auto-popup OAuth** - the browser automatically opens for authentication when the token is expired or missing, and no server restart is needed.

## Features

- **Auto-popup OAuth**: Browser opens automatically on startup if authentication is needed
- **Automatic token refresh**: Uses refresh tokens to stay authenticated
- **Re-auth without restart**: Use the `authenticate` tool to re-authenticate without restarting
- **Full Calendar API support**: Events, calendars, free/busy, search, RSVP

## Installation

```bash
cd gcal-mcp
npm install
npm run build
```

## Configuration

Add to your Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "gcal": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/gcal-mcp/build/index.js"]
    }
  }
}
```

## First-time Setup

When you first use any calendar tool, the server will automatically open your browser for Google OAuth authentication. Grant access and you're ready to go.

The token is stored at: `~/Claude/.security/gcal-token.json`

## Available Tools

### Authentication
- `authenticate` - Re-authenticate with Google (opens browser)
- `logout` - Clear stored credentials

### Calendars
- `list_calendars` - List all calendars
- `get_calendar` - Get calendar details

### Events
- `list_events` - List upcoming events
- `get_event` - Get event details
- `create_event` - Create a new event (supports Google Meet links!)
- `update_event` - Update an existing event
- `delete_event` - Delete an event
- `quick_add_event` - Create event with natural language ("Meeting tomorrow at 3pm")

### Search & Scheduling
- `search_events` - Search events by text
- `get_free_busy` - Check availability
- `respond_to_event` - RSVP to invitations (accept/decline/tentative)

## Examples

### List upcoming events
```
list_events with timeMin=2025-01-01T00:00:00Z, maxResults=10
```

### Create an event with Google Meet
```
create_event with summary="Team standup", startDateTime="2025-01-15T10:00:00-08:00", endDateTime="2025-01-15T10:30:00-08:00", createMeetLink=true
```

### Quick add (natural language)
```
quick_add_event with text="Lunch with John tomorrow at noon"
```

### Check availability
```
get_free_busy with timeMin="2025-01-15T09:00:00-08:00", timeMax="2025-01-15T17:00:00-08:00"
```

## Auth Flow Details

The authentication uses a similar pattern to the Linear MCP:

1. **On startup**: Server checks for existing token at `~/Claude/.security/gcal-token.json`
2. **If no token or expired**: Browser automatically opens for OAuth
3. **Token refresh**: If refresh token exists, automatically refreshes expired access tokens
4. **Manual re-auth**: Use `authenticate` tool anytime to switch accounts or re-auth

This means you never need to restart the MCP server just to refresh authentication!
