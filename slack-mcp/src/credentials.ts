// Default OAuth credentials for Auxia's Slack MCP
// These credentials identify the application, not the user.
// Each user still authenticates with their own Slack account.
//
// To set up:
// 1. Go to https://api.slack.com/apps
// 2. Create a new app (or use existing) for Auxia workspace
// 3. Under OAuth & Permissions:
//    - Add redirect URL: http://localhost:3036/oauth2callback
//    - Add User Token Scopes (see SLACK_USER_SCOPES below)
// 4. Copy Client ID and Client Secret from Basic Information
// 5. Update the values below

export const DEFAULT_CREDENTIALS = {
  client_id: '3302743237300.9659051232373',
  client_secret: 'b0c207eac0c69c2fda9559820ed26f41',
  redirect_uri: 'http://localhost:3036/oauth2callback',
};

// User token scopes needed for full functionality
export const SLACK_USER_SCOPES = [
  'channels:history',
  'channels:read',
  'channels:write',
  'channels:write.invites',
  'chat:write',
  'groups:history',
  'groups:read',
  'groups:write',
  'groups:write.invites',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'mpim:write',
  'reactions:read',
  'reactions:write',
  'search:read',
  'team:read',
  'users:read',
  'users:read.email',
  'users.profile:read',
  'usergroups:write',
];
