/**
 * Google Calendar client with automatic auth and token refresh.
 */

import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getAuthenticatedClient, clearToken, performOAuthFlow } from './auth.js';

// ========== Interfaces ==========

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  status?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  creator?: {
    email?: string;
    displayName?: string;
  };
  organizer?: {
    email?: string;
    displayName?: string;
  };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    organizer?: boolean;
    self?: boolean;
  }>;
  recurrence?: string[];
  recurringEventId?: string;
  conferenceData?: {
    conferenceId?: string;
    conferenceSolution?: {
      name?: string;
      iconUri?: string;
    };
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
      label?: string;
    }>;
  };
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{
      method?: string;
      minutes?: number;
    }>;
  };
}

export interface CalendarListEntry {
  id: string;
  summary?: string;
  description?: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  timeZone?: string;
}

export interface FreeBusyResponse {
  calendars: {
    [calendarId: string]: {
      busy: Array<{
        start: string;
        end: string;
      }>;
    };
  };
}

export interface CreateEventOptions {
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{ email: string }>;
  recurrence?: string[];
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{
      method: 'email' | 'popup';
      minutes: number;
    }>;
  };
  conferenceDataVersion?: 0 | 1;
  createMeetLink?: boolean;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

export class CalendarClient {
  private auth: OAuth2Client | null = null;
  private calendar: calendar_v3.Calendar | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Don't initialize in constructor - we'll do it lazily with auto-popup
  }

  /**
   * Initializes the client with auto-popup OAuth if needed.
   * This is called automatically on first API call.
   */
  async ensureInitialized(autoPopup: boolean = true): Promise<void> {
    if (this.calendar) {
      return;
    }

    // Avoid multiple simultaneous init attempts
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize(autoPopup);
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInitialize(autoPopup: boolean): Promise<void> {
    const { client, isNewAuth } = await getAuthenticatedClient(autoPopup);
    this.auth = client;
    this.calendar = google.calendar({ version: 'v3', auth: this.auth });

    if (isNewAuth) {
      console.error('Google Calendar authenticated via browser popup');
    } else {
      console.error('Google Calendar client initialized with existing token');
    }
  }

  /**
   * Force re-authentication (useful when token is invalid)
   */
  async reauthenticate(): Promise<void> {
    clearToken();
    this.auth = null;
    this.calendar = null;
    await this.ensureInitialized(true);
  }

  /**
   * Manually authenticate (for MCP tool)
   */
  async authenticate(): Promise<{ email?: string; message: string }> {
    const token = await performOAuthFlow();
    this.auth = null;
    this.calendar = null;
    await this.ensureInitialized(false);

    // Get user email
    try {
      const calendarList = await this.calendar!.calendarList.list({ maxResults: 1 });
      const primaryCalendar = calendarList.data.items?.find((c) => c.primary);
      return {
        email: primaryCalendar?.id ?? undefined,
        message: 'Authentication successful',
      };
    } catch {
      return { message: 'Authentication successful' };
    }
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.calendar !== null;
  }

  // ========== Calendar List Operations ==========

  async listCalendars(): Promise<CalendarListEntry[]> {
    await this.ensureInitialized();

    const response = await this.calendar!.calendarList.list({
      maxResults: 250,
    });

    return (response.data.items || []).map((cal) => ({
      id: cal.id || '',
      summary: cal.summary ?? undefined,
      description: cal.description ?? undefined,
      primary: cal.primary ?? undefined,
      accessRole: cal.accessRole ?? undefined,
      backgroundColor: cal.backgroundColor ?? undefined,
      foregroundColor: cal.foregroundColor ?? undefined,
      timeZone: cal.timeZone ?? undefined,
    }));
  }

  async getCalendar(calendarId: string): Promise<CalendarListEntry> {
    await this.ensureInitialized();

    const response = await this.calendar!.calendarList.get({
      calendarId,
    });

    return {
      id: response.data.id || '',
      summary: response.data.summary ?? undefined,
      description: response.data.description ?? undefined,
      primary: response.data.primary ?? undefined,
      accessRole: response.data.accessRole ?? undefined,
      backgroundColor: response.data.backgroundColor ?? undefined,
      foregroundColor: response.data.foregroundColor ?? undefined,
      timeZone: response.data.timeZone ?? undefined,
    };
  }

  // ========== Event Operations ==========

  async listEvents(options: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    singleEvents?: boolean;
    orderBy?: 'startTime' | 'updated';
    q?: string;
    showDeleted?: boolean;
  } = {}): Promise<CalendarEvent[]> {
    await this.ensureInitialized();

    const calendarId = options.calendarId || 'primary';
    const response = await this.calendar!.events.list({
      calendarId,
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      maxResults: options.maxResults || 50,
      singleEvents: options.singleEvents !== false, // Default to true
      orderBy: options.orderBy || 'startTime',
      q: options.q,
      showDeleted: options.showDeleted,
    });

    return (response.data.items || []).map((event) => this.parseEvent(event));
  }

  async getEvent(eventId: string, calendarId: string = 'primary'): Promise<CalendarEvent> {
    await this.ensureInitialized();

    const response = await this.calendar!.events.get({
      calendarId,
      eventId,
    });

    return this.parseEvent(response.data);
  }

  async createEvent(
    options: CreateEventOptions,
    calendarId: string = 'primary'
  ): Promise<CalendarEvent> {
    await this.ensureInitialized();

    const requestBody: calendar_v3.Schema$Event = {
      summary: options.summary,
      description: options.description,
      location: options.location,
      start: options.start,
      end: options.end,
      attendees: options.attendees,
      recurrence: options.recurrence,
      reminders: options.reminders,
    };

    // Add Google Meet if requested
    if (options.createMeetLink) {
      requestBody.conferenceData = {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      };
    }

    const response = await this.calendar!.events.insert({
      calendarId,
      requestBody,
      conferenceDataVersion: options.createMeetLink ? 1 : options.conferenceDataVersion,
      sendUpdates: options.sendUpdates || 'none',
    });

    return this.parseEvent(response.data);
  }

  async updateEvent(
    eventId: string,
    updates: Partial<CreateEventOptions>,
    calendarId: string = 'primary',
    sendUpdates: 'all' | 'externalOnly' | 'none' = 'none'
  ): Promise<CalendarEvent> {
    await this.ensureInitialized();

    // Get existing event first
    const existing = await this.calendar!.events.get({
      calendarId,
      eventId,
    });

    const requestBody: calendar_v3.Schema$Event = {
      ...existing.data,
      summary: updates.summary ?? existing.data.summary,
      description: updates.description ?? existing.data.description,
      location: updates.location ?? existing.data.location,
      start: updates.start ?? existing.data.start,
      end: updates.end ?? existing.data.end,
      attendees: updates.attendees ?? existing.data.attendees,
      recurrence: updates.recurrence ?? existing.data.recurrence,
      reminders: updates.reminders ?? existing.data.reminders,
    };

    const response = await this.calendar!.events.update({
      calendarId,
      eventId,
      requestBody,
      sendUpdates,
    });

    return this.parseEvent(response.data);
  }

  async deleteEvent(
    eventId: string,
    calendarId: string = 'primary',
    sendUpdates: 'all' | 'externalOnly' | 'none' = 'none'
  ): Promise<void> {
    await this.ensureInitialized();

    await this.calendar!.events.delete({
      calendarId,
      eventId,
      sendUpdates,
    });
  }

  async quickAddEvent(
    text: string,
    calendarId: string = 'primary',
    sendUpdates: 'all' | 'externalOnly' | 'none' = 'none'
  ): Promise<CalendarEvent> {
    await this.ensureInitialized();

    const response = await this.calendar!.events.quickAdd({
      calendarId,
      text,
      sendUpdates,
    });

    return this.parseEvent(response.data);
  }

  // ========== Free/Busy Operations ==========

  async getFreeBusy(options: {
    timeMin: string;
    timeMax: string;
    calendarIds?: string[];
    timeZone?: string;
  }): Promise<FreeBusyResponse> {
    await this.ensureInitialized();

    const calendarIds = options.calendarIds || ['primary'];

    const response = await this.calendar!.freebusy.query({
      requestBody: {
        timeMin: options.timeMin,
        timeMax: options.timeMax,
        timeZone: options.timeZone,
        items: calendarIds.map((id) => ({ id })),
      },
    });

    const calendars: FreeBusyResponse['calendars'] = {};
    if (response.data.calendars) {
      for (const [calId, calData] of Object.entries(response.data.calendars)) {
        calendars[calId] = {
          busy: (calData.busy || []).map((b) => ({
            start: b.start || '',
            end: b.end || '',
          })),
        };
      }
    }

    return { calendars };
  }

  // ========== RSVP Operations ==========

  async respondToEvent(
    eventId: string,
    response: 'accepted' | 'declined' | 'tentative',
    calendarId: string = 'primary',
    sendUpdates: 'all' | 'externalOnly' | 'none' = 'none'
  ): Promise<CalendarEvent> {
    await this.ensureInitialized();

    // Get the event first
    const event = await this.calendar!.events.get({
      calendarId,
      eventId,
    });

    // Find self in attendees and update response
    const attendees = event.data.attendees || [];
    const selfAttendee = attendees.find((a) => a.self);

    if (selfAttendee) {
      selfAttendee.responseStatus = response;
    }

    const updateResponse = await this.calendar!.events.patch({
      calendarId,
      eventId,
      requestBody: {
        attendees,
      },
      sendUpdates,
    });

    return this.parseEvent(updateResponse.data);
  }

  // ========== Search Operations ==========

  async searchEvents(
    query: string,
    options: {
      calendarId?: string;
      timeMin?: string;
      timeMax?: string;
      maxResults?: number;
    } = {}
  ): Promise<CalendarEvent[]> {
    return this.listEvents({
      calendarId: options.calendarId,
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      maxResults: options.maxResults,
      q: query,
      singleEvents: true,
      orderBy: 'startTime',
    });
  }

  // ========== Helper Methods ==========

  private parseEvent(event: calendar_v3.Schema$Event): CalendarEvent {
    return {
      id: event.id || '',
      summary: event.summary || undefined,
      description: event.description || undefined,
      location: event.location || undefined,
      start: {
        dateTime: event.start?.dateTime || undefined,
        date: event.start?.date || undefined,
        timeZone: event.start?.timeZone || undefined,
      },
      end: {
        dateTime: event.end?.dateTime || undefined,
        date: event.end?.date || undefined,
        timeZone: event.end?.timeZone || undefined,
      },
      status: event.status || undefined,
      htmlLink: event.htmlLink || undefined,
      created: event.created || undefined,
      updated: event.updated || undefined,
      creator: event.creator
        ? {
            email: event.creator.email || undefined,
            displayName: event.creator.displayName || undefined,
          }
        : undefined,
      organizer: event.organizer
        ? {
            email: event.organizer.email || undefined,
            displayName: event.organizer.displayName || undefined,
          }
        : undefined,
      attendees: event.attendees?.map((a) => ({
        email: a.email || undefined,
        displayName: a.displayName || undefined,
        responseStatus: a.responseStatus || undefined,
        organizer: a.organizer ?? undefined,
        self: a.self ?? undefined,
      })),
      recurrence: event.recurrence || undefined,
      recurringEventId: event.recurringEventId || undefined,
      conferenceData: event.conferenceData
        ? {
            conferenceId: event.conferenceData.conferenceId || undefined,
            conferenceSolution: event.conferenceData.conferenceSolution
              ? {
                  name: event.conferenceData.conferenceSolution.name || undefined,
                  iconUri: event.conferenceData.conferenceSolution.iconUri || undefined,
                }
              : undefined,
            entryPoints: event.conferenceData.entryPoints?.map((ep) => ({
              entryPointType: ep.entryPointType || undefined,
              uri: ep.uri || undefined,
              label: ep.label || undefined,
            })),
          }
        : undefined,
      reminders: event.reminders
        ? {
            useDefault: event.reminders.useDefault,
            overrides: event.reminders.overrides?.map((r) => ({
              method: r.method || undefined,
              minutes: r.minutes || undefined,
            })),
          }
        : undefined,
    };
  }
}
