import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getAuthenticatedClient, clearToken, performOAuthFlow } from './auth.js';

// ========== Interfaces ==========

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  date?: string;
  body?: string;
  bodyHtml?: string;
  attachments?: AttachmentInfo[];
  isUnread?: boolean;
  isStarred?: boolean;
}

export interface AttachmentInfo {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailThread {
  id: string;
  snippet?: string;
  historyId?: string;
  messages: GmailMessage[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string; // 'system' or 'user'
  messageListVisibility?: string;
  labelListVisibility?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
}

export interface GmailDraft {
  id: string;
  message: GmailMessage;
}

export interface SendMessageOptions {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  isHtml?: boolean;
  threadId?: string; // For replies
  inReplyTo?: string; // Message-ID header for threading
  references?: string; // References header for threading
}

export class GmailClient {
  private auth: OAuth2Client | null = null;
  private gmail: gmail_v1.Gmail | null = null;
  private userEmail: string = 'me';
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Don't initialize in constructor - we'll do it lazily with auto-popup
  }

  /**
   * Initializes the client with auto-popup OAuth if needed.
   * This is called automatically on first API call.
   */
  async ensureInitialized(autoPopup: boolean = true): Promise<void> {
    if (this.gmail) {
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
    this.gmail = google.gmail({ version: 'v1', auth: this.auth });

    if (isNewAuth) {
      console.error('Gmail authenticated via browser popup');
    } else {
      console.error('Gmail client initialized with existing token');
    }
  }

  /**
   * Force re-authentication (useful when token is invalid)
   */
  async reauthenticate(): Promise<void> {
    clearToken();
    this.auth = null;
    this.gmail = null;
    await this.ensureInitialized(true);
  }

  /**
   * Manually authenticate (for MCP tool)
   */
  async authenticate(): Promise<{ email?: string; message: string }> {
    await performOAuthFlow();
    this.auth = null;
    this.gmail = null;
    await this.ensureInitialized(false);

    // Get user email
    try {
      const profile = await this.gmail!.users.getProfile({ userId: 'me' });
      return {
        email: profile.data.emailAddress ?? undefined,
        message: 'Authentication successful',
      };
    } catch {
      return { message: 'Authentication successful' };
    }
  }

  /**
   * Log out and clear stored credentials
   */
  logout(): { message: string } {
    clearToken();
    this.auth = null;
    this.gmail = null;
    return { message: 'Logged out successfully. You will need to re-authenticate on next use.' };
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.gmail !== null;
  }

  // ========== Helper Methods ==========

  private parseHeaders(headers: gmail_v1.Schema$MessagePartHeader[] | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    if (headers) {
      for (const header of headers) {
        if (header.name && header.value) {
          result[header.name.toLowerCase()] = header.value;
        }
      }
    }
    return result;
  }

  private decodeBase64(data: string): string {
    // Gmail uses URL-safe base64
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  private encodeBase64(data: string): string {
    // Gmail uses URL-safe base64
    return Buffer.from(data).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private getBodyFromParts(parts: gmail_v1.Schema$MessagePart[] | undefined, mimeType: string): string | undefined {
    if (!parts) return undefined;

    for (const part of parts) {
      if (part.mimeType === mimeType && part.body?.data) {
        return this.decodeBase64(part.body.data);
      }
      if (part.parts) {
        const nested = this.getBodyFromParts(part.parts, mimeType);
        if (nested) return nested;
      }
    }
    return undefined;
  }

  private getAttachmentsFromParts(parts: gmail_v1.Schema$MessagePart[] | undefined): AttachmentInfo[] {
    const attachments: AttachmentInfo[] = [];
    if (!parts) return attachments;

    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        });
      }
      if (part.parts) {
        attachments.push(...this.getAttachmentsFromParts(part.parts));
      }
    }
    return attachments;
  }

  private parseMessage(message: gmail_v1.Schema$Message): GmailMessage {
    const headers = this.parseHeaders(message.payload?.headers);
    const labelIds = message.labelIds || [];

    // Get body - check single part first, then multipart
    let body: string | undefined;
    let bodyHtml: string | undefined;

    if (message.payload?.body?.data) {
      body = this.decodeBase64(message.payload.body.data);
    } else if (message.payload?.parts) {
      body = this.getBodyFromParts(message.payload.parts, 'text/plain');
      bodyHtml = this.getBodyFromParts(message.payload.parts, 'text/html');
    }

    return {
      id: message.id || '',
      threadId: message.threadId || '',
      labelIds: message.labelIds || undefined,
      snippet: message.snippet || undefined,
      from: headers['from'],
      to: headers['to'],
      cc: headers['cc'],
      bcc: headers['bcc'],
      subject: headers['subject'],
      date: headers['date'],
      body,
      bodyHtml,
      attachments: this.getAttachmentsFromParts(message.payload?.parts),
      isUnread: labelIds.includes('UNREAD'),
      isStarred: labelIds.includes('STARRED'),
    };
  }

  // ========== Core Read Operations ==========

  async listMessages(options: {
    query?: string;
    labelIds?: string[];
    maxResults?: number;
    pageToken?: string;
    includeSpamTrash?: boolean;
  } = {}): Promise<{ messages: GmailMessage[]; nextPageToken?: string }> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.messages.list({
        userId: this.userEmail,
        q: options.query,
        labelIds: options.labelIds,
        maxResults: options.maxResults || 50,
        pageToken: options.pageToken,
        includeSpamTrash: options.includeSpamTrash || false,
      });

      const messages: GmailMessage[] = [];
      if (response.data.messages) {
        // Fetch full message details for each
        for (const msg of response.data.messages) {
          if (msg.id) {
            const fullMsg = await this.getMessage(msg.id);
            messages.push(fullMsg);
          }
        }
      }

      return {
        messages,
        nextPageToken: response.data.nextPageToken || undefined,
      };
    } catch (error) {
      console.error('Error listing messages:', error);
      throw error;
    }
  }

  async getMessage(messageId: string, format: 'full' | 'metadata' | 'minimal' = 'full'): Promise<GmailMessage> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.messages.get({
        userId: this.userEmail,
        id: messageId,
        format,
      });

      return this.parseMessage(response.data);
    } catch (error) {
      console.error('Error getting message:', error);
      throw error;
    }
  }

  async searchMessages(query: string, maxResults: number = 50): Promise<GmailMessage[]> {
    const result = await this.listMessages({ query, maxResults });
    return result.messages;
  }

  // ========== Thread Operations ==========

  async listThreads(options: {
    query?: string;
    labelIds?: string[];
    maxResults?: number;
    pageToken?: string;
    includeSpamTrash?: boolean;
  } = {}): Promise<{ threads: GmailThread[]; nextPageToken?: string }> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.threads.list({
        userId: this.userEmail,
        q: options.query,
        labelIds: options.labelIds,
        maxResults: options.maxResults || 50,
        pageToken: options.pageToken,
        includeSpamTrash: options.includeSpamTrash || false,
      });

      const threads: GmailThread[] = [];
      if (response.data.threads) {
        for (const thread of response.data.threads) {
          if (thread.id) {
            const fullThread = await this.getThread(thread.id);
            threads.push(fullThread);
          }
        }
      }

      return {
        threads,
        nextPageToken: response.data.nextPageToken || undefined,
      };
    } catch (error) {
      console.error('Error listing threads:', error);
      throw error;
    }
  }

  async getThread(threadId: string): Promise<GmailThread> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.threads.get({
        userId: this.userEmail,
        id: threadId,
        format: 'full',
      });

      return {
        id: response.data.id || '',
        snippet: response.data.snippet || undefined,
        historyId: response.data.historyId || undefined,
        messages: (response.data.messages || []).map(msg => this.parseMessage(msg)),
      };
    } catch (error) {
      console.error('Error getting thread:', error);
      throw error;
    }
  }

  // ========== Send Operations ==========

  async sendMessage(options: SendMessageOptions): Promise<GmailMessage> {
    await this.ensureInitialized();

    try {
      // Build email in RFC 2822 format
      const boundary = `boundary_${Date.now()}`;
      const contentType = options.isHtml ? 'text/html' : 'text/plain';

      let emailLines = [
        `To: ${options.to}`,
        `Subject: ${options.subject}`,
        `Content-Type: ${contentType}; charset=utf-8`,
      ];

      if (options.cc) {
        emailLines.push(`Cc: ${options.cc}`);
      }
      if (options.bcc) {
        emailLines.push(`Bcc: ${options.bcc}`);
      }
      if (options.inReplyTo) {
        emailLines.push(`In-Reply-To: ${options.inReplyTo}`);
      }
      if (options.references) {
        emailLines.push(`References: ${options.references}`);
      }

      emailLines.push('', options.body);

      const email = emailLines.join('\r\n');
      const encodedEmail = this.encodeBase64(email);

      const response = await this.gmail!.users.messages.send({
        userId: this.userEmail,
        requestBody: {
          raw: encodedEmail,
          threadId: options.threadId,
        },
      });

      // Fetch and return the sent message
      if (response.data.id) {
        return await this.getMessage(response.data.id);
      }

      return this.parseMessage(response.data);
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async replyToMessage(messageId: string, body: string, options: {
    replyAll?: boolean;
    isHtml?: boolean;
  } = {}): Promise<GmailMessage> {
    // Get the original message to extract headers
    const original = await this.getMessage(messageId);

    if (!original.threadId) {
      throw new Error('Original message has no thread ID');
    }

    // Build reply headers
    const to = options.replyAll && original.cc
      ? `${original.from}, ${original.cc}`
      : original.from || '';

    // Get Message-ID header for threading
    const response = await this.gmail!.users.messages.get({
      userId: this.userEmail,
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['Message-ID'],
    });

    const headers = this.parseHeaders(response.data.payload?.headers);
    const messageIdHeader = headers['message-id'];

    return this.sendMessage({
      to,
      subject: original.subject?.startsWith('Re:') ? original.subject : `Re: ${original.subject}`,
      body,
      isHtml: options.isHtml,
      threadId: original.threadId,
      inReplyTo: messageIdHeader,
      references: messageIdHeader,
    });
  }

  async forwardMessage(messageId: string, to: string, comment?: string): Promise<GmailMessage> {
    const original = await this.getMessage(messageId);

    let body = '';
    if (comment) {
      body = `${comment}\n\n`;
    }
    body += `---------- Forwarded message ---------\n`;
    body += `From: ${original.from || 'Unknown'}\n`;
    body += `Date: ${original.date || 'Unknown'}\n`;
    body += `Subject: ${original.subject || '(no subject)'}\n`;
    body += `To: ${original.to || 'Unknown'}\n\n`;
    body += original.body || original.snippet || '';

    return this.sendMessage({
      to,
      subject: original.subject?.startsWith('Fwd:') ? original.subject : `Fwd: ${original.subject}`,
      body,
    });
  }

  // ========== Draft Operations ==========

  async listDrafts(maxResults: number = 50): Promise<GmailDraft[]> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.drafts.list({
        userId: this.userEmail,
        maxResults,
      });

      const drafts: GmailDraft[] = [];
      if (response.data.drafts) {
        for (const draft of response.data.drafts) {
          if (draft.id) {
            const fullDraft = await this.getDraft(draft.id);
            drafts.push(fullDraft);
          }
        }
      }

      return drafts;
    } catch (error) {
      console.error('Error listing drafts:', error);
      throw error;
    }
  }

  async getDraft(draftId: string): Promise<GmailDraft> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.drafts.get({
        userId: this.userEmail,
        id: draftId,
        format: 'full',
      });

      return {
        id: response.data.id || '',
        message: response.data.message ? this.parseMessage(response.data.message) : {} as GmailMessage,
      };
    } catch (error) {
      console.error('Error getting draft:', error);
      throw error;
    }
  }

  async createDraft(options: SendMessageOptions): Promise<GmailDraft> {
    await this.ensureInitialized();

    try {
      const contentType = options.isHtml ? 'text/html' : 'text/plain';

      let emailLines = [
        `To: ${options.to}`,
        `Subject: ${options.subject}`,
        `Content-Type: ${contentType}; charset=utf-8`,
      ];

      if (options.cc) {
        emailLines.push(`Cc: ${options.cc}`);
      }
      if (options.bcc) {
        emailLines.push(`Bcc: ${options.bcc}`);
      }

      emailLines.push('', options.body);

      const email = emailLines.join('\r\n');
      const encodedEmail = this.encodeBase64(email);

      const response = await this.gmail!.users.drafts.create({
        userId: this.userEmail,
        requestBody: {
          message: {
            raw: encodedEmail,
            threadId: options.threadId,
          },
        },
      });

      if (response.data.id) {
        return await this.getDraft(response.data.id);
      }

      return {
        id: response.data.id || '',
        message: response.data.message ? this.parseMessage(response.data.message) : {} as GmailMessage,
      };
    } catch (error) {
      console.error('Error creating draft:', error);
      throw error;
    }
  }

  async updateDraft(draftId: string, options: SendMessageOptions): Promise<GmailDraft> {
    await this.ensureInitialized();

    try {
      const contentType = options.isHtml ? 'text/html' : 'text/plain';

      let emailLines = [
        `To: ${options.to}`,
        `Subject: ${options.subject}`,
        `Content-Type: ${contentType}; charset=utf-8`,
      ];

      if (options.cc) {
        emailLines.push(`Cc: ${options.cc}`);
      }

      emailLines.push('', options.body);

      const email = emailLines.join('\r\n');
      const encodedEmail = this.encodeBase64(email);

      const response = await this.gmail!.users.drafts.update({
        userId: this.userEmail,
        id: draftId,
        requestBody: {
          message: {
            raw: encodedEmail,
            threadId: options.threadId,
          },
        },
      });

      if (response.data.id) {
        return await this.getDraft(response.data.id);
      }

      return {
        id: response.data.id || '',
        message: response.data.message ? this.parseMessage(response.data.message) : {} as GmailMessage,
      };
    } catch (error) {
      console.error('Error updating draft:', error);
      throw error;
    }
  }

  async sendDraft(draftId: string): Promise<GmailMessage> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.drafts.send({
        userId: this.userEmail,
        requestBody: {
          id: draftId,
        },
      });

      if (response.data.id) {
        return await this.getMessage(response.data.id);
      }

      return this.parseMessage(response.data);
    } catch (error) {
      console.error('Error sending draft:', error);
      throw error;
    }
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.gmail!.users.drafts.delete({
        userId: this.userEmail,
        id: draftId,
      });
    } catch (error) {
      console.error('Error deleting draft:', error);
      throw error;
    }
  }

  // ========== Label Operations ==========

  async listLabels(): Promise<GmailLabel[]> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.labels.list({
        userId: this.userEmail,
      });

      const labels: GmailLabel[] = [];
      if (response.data.labels) {
        for (const label of response.data.labels) {
          if (label.id) {
            // Get full label details
            const fullLabel = await this.getLabel(label.id);
            labels.push(fullLabel);
          }
        }
      }

      return labels;
    } catch (error) {
      console.error('Error listing labels:', error);
      throw error;
    }
  }

  async getLabel(labelId: string): Promise<GmailLabel> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.labels.get({
        userId: this.userEmail,
        id: labelId,
      });

      return {
        id: response.data.id || '',
        name: response.data.name || '',
        type: response.data.type || 'user',
        messageListVisibility: response.data.messageListVisibility || undefined,
        labelListVisibility: response.data.labelListVisibility || undefined,
        messagesTotal: response.data.messagesTotal || undefined,
        messagesUnread: response.data.messagesUnread || undefined,
        threadsTotal: response.data.threadsTotal || undefined,
        threadsUnread: response.data.threadsUnread || undefined,
      };
    } catch (error) {
      console.error('Error getting label:', error);
      throw error;
    }
  }

  async createLabel(name: string, options: {
    messageListVisibility?: 'show' | 'hide';
    labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
    backgroundColor?: string;
    textColor?: string;
  } = {}): Promise<GmailLabel> {
    await this.ensureInitialized();

    try {
      const requestBody: gmail_v1.Schema$Label = {
        name,
        messageListVisibility: options.messageListVisibility,
        labelListVisibility: options.labelListVisibility,
      };

      if (options.backgroundColor || options.textColor) {
        requestBody.color = {
          backgroundColor: options.backgroundColor,
          textColor: options.textColor,
        };
      }

      const response = await this.gmail!.users.labels.create({
        userId: this.userEmail,
        requestBody,
      });

      return {
        id: response.data.id || '',
        name: response.data.name || '',
        type: response.data.type || 'user',
        messageListVisibility: response.data.messageListVisibility || undefined,
        labelListVisibility: response.data.labelListVisibility || undefined,
      };
    } catch (error) {
      console.error('Error creating label:', error);
      throw error;
    }
  }

  async deleteLabel(labelId: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.gmail!.users.labels.delete({
        userId: this.userEmail,
        id: labelId,
      });
    } catch (error) {
      console.error('Error deleting label:', error);
      throw error;
    }
  }

  // ========== Message Organization ==========

  async modifyLabels(messageId: string, options: {
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }): Promise<GmailMessage> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.messages.modify({
        userId: this.userEmail,
        id: messageId,
        requestBody: {
          addLabelIds: options.addLabelIds,
          removeLabelIds: options.removeLabelIds,
        },
      });

      return await this.getMessage(response.data.id || messageId);
    } catch (error) {
      console.error('Error modifying labels:', error);
      throw error;
    }
  }

  async archiveMessage(messageId: string): Promise<GmailMessage> {
    return this.modifyLabels(messageId, { removeLabelIds: ['INBOX'] });
  }

  async unarchiveMessage(messageId: string): Promise<GmailMessage> {
    return this.modifyLabels(messageId, { addLabelIds: ['INBOX'] });
  }

  async trashMessage(messageId: string): Promise<GmailMessage> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.messages.trash({
        userId: this.userEmail,
        id: messageId,
      });

      return await this.getMessage(response.data.id || messageId);
    } catch (error) {
      console.error('Error trashing message:', error);
      throw error;
    }
  }

  async untrashMessage(messageId: string): Promise<GmailMessage> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.messages.untrash({
        userId: this.userEmail,
        id: messageId,
      });

      return await this.getMessage(response.data.id || messageId);
    } catch (error) {
      console.error('Error untrashing message:', error);
      throw error;
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.gmail!.users.messages.delete({
        userId: this.userEmail,
        id: messageId,
      });
    } catch (error) {
      console.error('Error deleting message:', error);
      throw error;
    }
  }

  async markAsRead(messageId: string): Promise<GmailMessage> {
    return this.modifyLabels(messageId, { removeLabelIds: ['UNREAD'] });
  }

  async markAsUnread(messageId: string): Promise<GmailMessage> {
    return this.modifyLabels(messageId, { addLabelIds: ['UNREAD'] });
  }

  async starMessage(messageId: string): Promise<GmailMessage> {
    return this.modifyLabels(messageId, { addLabelIds: ['STARRED'] });
  }

  async unstarMessage(messageId: string): Promise<GmailMessage> {
    return this.modifyLabels(messageId, { removeLabelIds: ['STARRED'] });
  }

  async markAsImportant(messageId: string): Promise<GmailMessage> {
    return this.modifyLabels(messageId, { addLabelIds: ['IMPORTANT'] });
  }

  async markAsNotImportant(messageId: string): Promise<GmailMessage> {
    return this.modifyLabels(messageId, { removeLabelIds: ['IMPORTANT'] });
  }

  // ========== Batch Operations ==========

  async batchModifyLabels(messageIds: string[], options: {
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.gmail!.users.messages.batchModify({
        userId: this.userEmail,
        requestBody: {
          ids: messageIds,
          addLabelIds: options.addLabelIds,
          removeLabelIds: options.removeLabelIds,
        },
      });
    } catch (error) {
      console.error('Error batch modifying labels:', error);
      throw error;
    }
  }

  async batchDelete(messageIds: string[]): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.gmail!.users.messages.batchDelete({
        userId: this.userEmail,
        requestBody: {
          ids: messageIds,
        },
      });
    } catch (error) {
      console.error('Error batch deleting messages:', error);
      throw error;
    }
  }

  // ========== Attachment Operations ==========

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.messages.attachments.get({
        userId: this.userEmail,
        messageId,
        id: attachmentId,
      });

      if (response.data.data) {
        // Gmail uses URL-safe base64
        const base64 = response.data.data.replace(/-/g, '+').replace(/_/g, '/');
        return Buffer.from(base64, 'base64');
      }

      throw new Error('No attachment data received');
    } catch (error) {
      console.error('Error getting attachment:', error);
      throw error;
    }
  }

  // ========== Profile Operations ==========

  async getProfile(): Promise<{ emailAddress: string; messagesTotal: number; threadsTotal: number; historyId: string }> {
    await this.ensureInitialized();

    try {
      const response = await this.gmail!.users.getProfile({
        userId: this.userEmail,
      });

      return {
        emailAddress: response.data.emailAddress || '',
        messagesTotal: response.data.messagesTotal || 0,
        threadsTotal: response.data.threadsTotal || 0,
        historyId: response.data.historyId || '',
      };
    } catch (error) {
      console.error('Error getting profile:', error);
      throw error;
    }
  }
}
