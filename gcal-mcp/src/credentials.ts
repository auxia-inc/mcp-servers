// Default OAuth credentials for Google Calendar MCP
// These credentials identify the application, not the user.
// Each user still authenticates with their own Google account.
// Using the same OAuth client as gdrive-mcp for convenience.
export const DEFAULT_CREDENTIALS = {
  client_id: '646675816843-sa846rrk56e0v0ffcucgem8vibpqbciv.apps.googleusercontent.com',
  client_secret: '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',
  redirect_uri: 'http://localhost:3036/oauth2callback',
};

// Google Calendar API scopes
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];
