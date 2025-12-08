# Slack Message Manager MCP Server

Custom MCP (Model Context Protocol) server for managing Slack messages at Auxia. Helps you stay on top of mentions, DMs, and channel messages directly through Claude Code.

## Features

- **Get Mentions**: Find all messages where you're tagged
- **Get DMs**: Read recent direct messages
- **Get Recent Messages**: Fetch messages from all channels or specific ones
- **List Channels**: See all channels you're a member of
- **Add Reactions**: React to messages with emojis
- **Post Messages**: Send messages to channels or threads

## Prerequisites

### 1. Create a Slack App

1. Go to https://api.slack.com/apps
2. Click **"Create New App"** → **"From scratch"**
3. Name it (e.g., "Personal Assistant") and select **Auxia workspace**
4. Add **User Token Scopes** (OAuth & Permissions → User Token Scopes):
   - `channels:history` - Read messages in public channels
   - `channels:read` - View basic channel info
   - `chat:write` - Send messages
   - `groups:history` - Read messages in private channels
   - `groups:read` - List private channels
   - `im:history` - Read direct messages
   - `im:read` - View DM info
   - `im:write` - Send DMs
   - `mpim:history` - Read group DMs
   - `mpim:read` - View group DM info
   - `mpim:write` - Send group DMs
   - `reactions:read` - View reactions
   - `reactions:write` - Add emoji reactions
   - `search:read` - Search messages
   - `team:read` - Workspace info
   - `users:read` - View user information
   - `users:read.email` - View user emails
   - `users.profile:read` - View user profiles
5. Click **"Install to Workspace"** and authorize
6. **Copy the User OAuth Token** (starts with `xoxp-`)

**Tip:** A sample Slack app manifest is available at `slack-app-manifest.json` for reference.

### 2. Get Your User ID

Find your Slack User ID (starts with `U`):

**Option A: Via Slack Profile**
1. Click your profile picture in Slack
2. Click "Profile"
3. Click "More" (...) → "Copy member ID"

**Option B: Via API Test**
1. Go to https://api.slack.com/methods/auth.test/test
2. Use your bot token
3. Look for `user_id` in the response

## Installation

### 1. Install Dependencies

```bash
cd slack-mcp
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Configure Claude Code

Edit your `~/.claude.json` file to add the MCP server under your project's `mcpServers` section:

```json
{
  "projects": {
    "/path/to/your/project": {
      "mcpServers": {
        "slack-auxia": {
          "type": "stdio",
          "command": "node",
          "args": ["/path/to/mcp-servers/slack-mcp/build/index.js"],
          "env": {
            "SLACK_BOT_TOKEN": "xoxp-your-user-token-here",
            "SLACK_USER_ID": "U01234567"
          }
        }
      }
    }
  }
}
```

**Important:**
- Replace `/path/to/your/project` with your actual project path
- Replace `/path/to/mcp-servers/` with where you cloned this repo
- Replace `xoxp-your-user-token-here` with your **user token** (see note below)
- Replace `U01234567` with your actual Slack user ID
- This file is in your home directory and is **never checked into git**

**Note on Token Types:**
| Token Type | Prefix | Access Level |
|------------|--------|--------------|
| Bot Token | `xoxb-` | Only channels where bot is invited |
| **User Token** | `xoxp-` | Full access to your DMs and all channels you're in |

For full functionality (especially reading DMs), use a **user token** (`xoxp-`) from your Slack app's OAuth settings.

### 4. Restart Claude Code

After updating the config, restart Claude Code for the changes to take effect.

## Usage

### Get Messages Where You're Mentioned

```
Show me messages where I'm mentioned in the last 24 hours
```

Claude will use the `get_mentions` tool to fetch messages.

### Get Your DMs

```
Show me my recent DMs
```

Claude will use the `get_dms` tool.

### Get Recent Channel Messages

```
What are the recent messages in all my channels?
```

Or for a specific channel:

```
Show me recent messages in channel C01234567
```

### List Your Channels

```
What Slack channels am I in?
```

### Add Reactions

```
Add a thumbsup reaction to the message in channel C01234567 at timestamp 1234567890.123456
```

### Post Messages

```
Post "Thanks for the update!" to channel C01234567
```

Or reply in a thread:

```
Reply "Sounds good" to the thread at timestamp 1234567890.123456 in channel C01234567
```

## Available Tools

### `get_mentions`
Get messages where you are mentioned or tagged.

**Parameters:**
- `limit` (optional): Maximum number of messages (default: 50)
- `hoursAgo` (optional): How many hours back to search (default: 24)

### `get_dms`
Get recent direct messages sent to you.

**Parameters:**
- `limit` (optional): Maximum number of messages (default: 50)
- `hoursAgo` (optional): How many hours back to search (default: 24)

### `get_recent_messages`
Get recent messages from all channels or a specific channel.

**Parameters:**
- `channelId` (optional): Specific channel ID
- `limit` (optional): Maximum number of messages (default: 50)
- `hoursAgo` (optional): How many hours back to search (default: 24)

### `get_my_channels`
List all channels, DMs, and private channels you are a member of.

**Parameters:** None

### `add_reaction`
Add an emoji reaction to a message.

**Parameters:**
- `channelId` (required): Channel ID where the message is
- `timestamp` (required): Message timestamp (ts field)
- `emoji` (required): Emoji name without colons (e.g., "thumbsup")

### `post_message`
Post a message to a channel or thread.

**Parameters:**
- `channelId` (required): Channel ID to post to
- `text` (required): Message text
- `threadTs` (optional): Thread timestamp to reply in thread

## Development

### Watch Mode

```bash
npm run watch
```

This will automatically rebuild when you make changes to the TypeScript files.

### Testing

After building, you can test the MCP server directly:

```bash
node build/index.js
```

The server communicates via stdio, so you'll need to send JSON-RPC messages to test it manually.

## Troubleshooting

### "SLACK_BOT_TOKEN environment variable is required"

Make sure you've added the `env` section to your `~/.claude.json` with your token.

### "Missing scope" errors

Go back to your Slack app settings and add the missing OAuth scopes under "OAuth & Permissions".

### Can't see messages

Make sure your bot has been invited to the channels you want to read from. In Slack, type:
```
/invite @YourBotName
```

### Changes not taking effect

1. Make sure you ran `npm run build` after changing code
2. Restart Claude Code after updating the MCP config

## Security Notes

- **Never commit your bot token** - it stays in your personal `~/.claude/mcp_config.json`
- Each team member needs their own Slack app with their own token
- The bot token has limited permissions (only what you granted in scopes)
- Messages are only accessible to the user who created the bot token

## For Team Members

1. Follow the "Prerequisites" section to create your own Slack app
2. Get your own bot token and user ID
3. Install dependencies and build the project
4. Configure your personal `~/.claude/mcp_config.json` with your credentials
5. Restart Claude Code

Each team member uses their own credentials - nothing is shared or checked into git.
