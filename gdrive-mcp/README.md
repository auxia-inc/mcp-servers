# Google Drive MCP Server

A Model Context Protocol (MCP) server for accessing Google Drive files from Claude Code.

## Features

### File Operations
- **List & Search**: Browse Google Drive with powerful search queries
- **Read files**: Access content from Google Docs, Sheets, Slides, and plain text files
- **File management**: Create, move, copy, delete files and folders
- **Upload files**: Upload local files (docx, pdf, images, etc.) to Google Drive
- **Metadata**: Get and update file metadata and custom properties

### Google Sheets
- **Read operations**: Read entire spreadsheets or specific sheets/ranges
- **Write operations**: Update cells, append rows, batch updates
- **Create spreadsheets**: Programmatically create new sheets

### Collaboration
- **Version history**: List, read, and compare file revisions
- **Comments**: List, create, resolve/unresolve comments
- **Sharing**: Share files, manage permissions, create public links

### Shared Drives (Team Drives)
- **List shared drives**: Browse all team drives you have access to
- **Access shared drive files**: List and manage files within shared drives
- **Drive details**: Get information about shared drive capabilities

### Advanced Features
- **Advanced search**: Search by owner, date range, starred files, recent files
- **Batch operations**: Read multiple files or get metadata in batch
- **Export options**: Export Google Workspace files to different formats

## Setup

### 1. Install Dependencies and Build

```bash
cd gdrive-mcp
npm install
npm run build
```

### 2. Authenticate

Run the authentication helper script:

```bash
npm run auth
```

This will:
1. Open your browser to authorize the app
2. Save the access token to `~/Claude/.security/gdrive-token.json`

### 3. Configure Claude Code

Add to your `~/.claude.json` at the global level (root `mcpServers`):

```json
{
  "mcpServers": {
    "gdrive": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mcp-servers/gdrive-mcp/build/index.js"],
      "env": {}
    }
  }
}
```

Then restart Claude Code to load the server.

## Available Tools

### File Operations

| Tool | Description |
|------|-------------|
| `list_files` | List files with optional search query and folder filter |
| `read_file` | Read content from Docs, Sheets, Slides, or text files |
| `search_files` | Search for files by name |
| `create_file` | Create a new file |
| `upload_file` | Upload a local file to Google Drive |
| `create_folder` | Create a new folder |
| `move_file` | Move a file to a different folder |
| `copy_file` | Create a copy of a file |
| `delete_file` | Delete a file (moves to trash) |
| `update_file_metadata` | Update file name, description, starred status |
| `get_file_metadata` | Get detailed metadata for a file |

### Google Sheets

| Tool | Description |
|------|-------------|
| `list_sheets` | List all sheets (tabs) in a spreadsheet |
| `read_sheet` | Read content from a specific sheet or all sheets |
| `update_cell` | Update a single cell |
| `append_row` | Append a new row |
| `batch_update_cells` | Update multiple cell ranges at once |
| `create_spreadsheet` | Create a new spreadsheet |

### Version History

| Tool | Description |
|------|-------------|
| `get_file_revisions` | List all versions/revisions of a file |
| `read_file_revision` | Read content from a specific revision |
| `compare_revisions` | Compare two revisions and show differences |

### Comments & Collaboration

| Tool | Description |
|------|-------------|
| `list_comments` | List all comments on a file |
| `create_comment` | Add a comment to a file |
| `resolve_comment` | Mark a comment as resolved |
| `unresolve_comment` | Mark a comment as unresolved |

### Sharing & Permissions

| Tool | Description |
|------|-------------|
| `share_file` | Share a file with a user via email |
| `get_permissions` | List all sharing settings for a file |
| `update_permission` | Update an existing permission |
| `delete_permission` | Remove sharing access |
| `create_public_link` | Create a public shareable link |

### Advanced Search

| Tool | Description |
|------|-------------|
| `search_by_owner` | Search for files owned by a specific user |
| `search_by_date_range` | Search for files modified within a date range |
| `search_starred` | Search for starred files |
| `search_recent` | Search for recently modified files |
| `star_file` | Star/favorite a file |
| `unstar_file` | Unstar/unfavorite a file |

### Batch Operations

| Tool | Description |
|------|-------------|
| `batch_read_files` | Read content from multiple files at once |
| `batch_get_metadata` | Get metadata for multiple files at once |

### Shared Drives

| Tool | Description |
|------|-------------|
| `list_shared_drives` | List all shared drives you have access to |
| `get_shared_drive` | Get details about a specific shared drive |
| `list_files_in_shared_drive` | List files in a shared drive |

### Export & Download

| Tool | Description |
|------|-------------|
| `export_file` | Export a Google Workspace file to a different format |
| `download_file` | Download a file to a local path |
| `set_custom_properties` | Set custom key-value properties on a file |

## Common MIME Types

- Google Docs: `application/vnd.google-apps.document`
- Google Sheets: `application/vnd.google-apps.spreadsheet`
- Google Slides: `application/vnd.google-apps.presentation`
- Folders: `application/vnd.google-apps.folder`
- PDF: `application/pdf`
- Plain text: `text/plain`

## Example Usage

```
> List my recent files
> Search for files containing "quarterly report"
> Read the content of file ID "1a2b3c4d..."
> Upload /path/to/document.docx to my Drive
> Share this file with colleague@company.com as editor
> What files did I modify in the last 7 days?
```

## Troubleshooting

### "Authentication required. Token not found."

Run `npm run auth` to authenticate and generate a token.

### Token expired

Delete `~/Claude/.security/gdrive-token.json` and run `npm run auth` again.

## Security Notes

- **Never commit your token file** (`~/Claude/.security/gdrive-token.json`) - it contains your personal access credentials
- The embedded OAuth client ID/secret only identify the application, not any user data
- Each user authenticates with their own Google account and only sees files they have access to
- You can override the default credentials by creating `~/Claude/gdrive-credentials.json` if needed
