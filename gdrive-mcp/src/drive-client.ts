import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import {
  getAuthenticatedClient,
  clearToken,
  loadStoredToken,
  performOAuthFlow,
} from './auth.js';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
}

interface FileRevision {
  id: string;
  modifiedTime: string;
  lastModifyingUser?: {
    displayName: string;
    emailAddress: string;
  };
  size?: string;
  keepForever?: boolean;
}

interface FileComment {
  id: string;
  content: string;
  author: {
    displayName: string;
    emailAddress?: string;
  };
  createdTime: string;
  modifiedTime: string;
  resolved?: boolean;
  quotedFileContent?: {
    value: string;
  };
  replies?: Array<{
    id: string;
    content: string;
    author: {
      displayName: string;
      emailAddress?: string;
    };
    createdTime: string;
  }>;
}

interface FilePermission {
  id: string;
  type: string; // 'user', 'group', 'domain', 'anyone'
  role: string; // 'owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'
  emailAddress?: string;
  displayName?: string;
  domain?: string;
}

interface FileMetadata {
  id: string;
  name: string;
  mimeType: string;
  description?: string;
  starred?: boolean;
  createdTime: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  permissions?: FilePermission[];
  properties?: { [key: string]: string };
}

interface SharedDrive {
  id: string;
  name: string;
  createdTime?: string;
  backgroundImageLink?: string;
  capabilities?: {
    canAddChildren?: boolean;
    canComment?: boolean;
    canCopy?: boolean;
    canDeleteDrive?: boolean;
    canDownload?: boolean;
    canEdit?: boolean;
    canListChildren?: boolean;
    canManageMembers?: boolean;
    canReadRevisions?: boolean;
    canRename?: boolean;
    canRenameDrive?: boolean;
    canShare?: boolean;
  };
}

interface DriveActivity {
  primaryActionDetail?: {
    create?: object;
    edit?: object;
    move?: object;
    rename?: { oldTitle?: string; newTitle?: string };
    delete?: object;
    restore?: object;
    comment?: {
      post?: { subtype?: string };
      assignment?: { subtype?: string; assignedUser?: { knownUser?: { personName?: string } } };
      suggestion?: { subtype?: string };
      mentionedUsers?: Array<{ knownUser?: { personName?: string } }>;
    };
    permissionChange?: object;
  };
  actors?: Array<{
    user?: {
      knownUser?: {
        personName?: string;
        isCurrentUser?: boolean;
      };
    };
  }>;
  targets?: Array<{
    driveItem?: {
      name?: string;
      title?: string;
      mimeType?: string;
      owner?: { user?: { knownUser?: { personName?: string } } };
    };
    fileComment?: {
      legacyCommentId?: string;
      legacyDiscussionId?: string;
      linkToDiscussion?: string;
      parent?: {
        name?: string;
        title?: string;
      };
    };
  }>;
  timestamp?: string;
  timeRange?: {
    startTime?: string;
    endTime?: string;
  };
}

export class GoogleDriveClient {
  private auth: OAuth2Client | null = null;
  private drive: any = null;
  private sheets: any = null;
  private driveactivity: any = null;
  private people: any = null;
  private initPromise: Promise<void> | null = null;
  private peopleCache: Map<string, string> = new Map(); // Cache people IDs to names

  constructor() {
    // Don't initialize in constructor - we'll do it lazily with auto-popup
  }

  /**
   * Ensures the client is initialized, with optional auto-popup OAuth
   * @param autoPopup - If true, automatically opens browser for auth when needed
   * @param forceRefresh - If true, re-reads token from disk even if already initialized
   */
  async ensureInitialized(autoPopup: boolean = true, forceRefresh: boolean = false): Promise<void> {
    if (this.drive && !forceRefresh) {
      return; // Already initialized
    }

    // If force refresh, reset state
    if (forceRefresh) {
      this.auth = null;
      this.drive = null;
      this.sheets = null;
      this.driveactivity = null;
      this.people = null;
    }

    // If initialization is in progress, wait for it
    if (this.initPromise) {
      return this.initPromise;
    }

    // Start initialization
    this.initPromise = this.doInitialize(autoPopup);
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Performs actual initialization
   */
  private async doInitialize(autoPopup: boolean): Promise<void> {
    try {
      const { client, isNewAuth } = await getAuthenticatedClient(autoPopup);
      this.auth = client;

      if (isNewAuth) {
        console.error('Successfully authenticated with Google Drive');
      }

      // Initialize Drive API
      this.drive = google.drive({ version: 'v3', auth: this.auth });
      // Initialize Sheets API
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      // Initialize Drive Activity API
      this.driveactivity = google.driveactivity({ version: 'v2', auth: this.auth });
      // Initialize People API
      this.people = google.people({ version: 'v1', auth: this.auth });
    } catch (error) {
      console.error('Failed to initialize Google Drive client:', error);
      throw error;
    }
  }

  /**
   * Force re-authentication even if token exists
   */
  async reauthenticate(): Promise<void> {
    clearToken();
    this.auth = null;
    this.drive = null;
    this.sheets = null;
    this.driveactivity = null;
    this.people = null;
    await this.ensureInitialized(true);
  }

  /**
   * Manual authentication trigger (for MCP tool)
   */
  async authenticate(): Promise<{ success: boolean; email?: string; message: string }> {
    try {
      // First, try to re-read token from disk (in case it was updated externally)
      try {
        await this.ensureInitialized(false, true); // forceRefresh = true, autoPopup = false
      } catch {
        // No token exists, that's fine - we'll do OAuth below
      }

      if (this.drive) {
        // Verify the token works
        try {
          const about = await this.drive.about.get({ fields: 'user' });
          return {
            success: true,
            email: about.data.user?.emailAddress,
            message: `Already authenticated as ${about.data.user?.emailAddress}`,
          };
        } catch {
          // Token is invalid, need to re-auth
          console.error('Existing token invalid, clearing and re-authenticating');
          clearToken();
          this.auth = null;
          this.drive = null;
          this.sheets = null;
          this.driveactivity = null;
          this.people = null;
        }
      }

      // Perform OAuth flow (opens browser)
      await performOAuthFlow();

      // Re-initialize with new token
      await this.ensureInitialized(false, true); // forceRefresh = true

      // Get user info
      const about = await this.drive.about.get({ fields: 'user' });
      return {
        success: true,
        email: about.data.user?.emailAddress,
        message: `Successfully authenticated as ${about.data.user?.emailAddress}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Clear stored credentials (for MCP tool)
   */
  logout(): { success: boolean; message: string } {
    clearToken();
    this.auth = null;
    this.drive = null;
    this.sheets = null;
    this.driveactivity = null;
    this.people = null;
    return {
      success: true,
      message: 'Successfully logged out. Use the authenticate tool to sign in again.',
    };
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return loadStoredToken() !== null;
  }

  async listFiles(
    query?: string,
    folderId?: string,
    pageSize: number = 100
  ): Promise<DriveFile[]> {
    await this.ensureInitialized();

    try {
      let q = query || '';
      if (folderId) {
        q = q ? `${q} and '${folderId}' in parents` : `'${folderId}' in parents`;
      }

      const response = await this.drive.files.list({
        pageSize: Math.min(pageSize, 1000),
        fields: 'files(id, name, mimeType, webViewLink, modifiedTime, size)',
        q: q || undefined,
        orderBy: 'modifiedTime desc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      return response.data.files || [];
    } catch (error) {
      console.error('Error listing files:', error);
      throw error;
    }
  }

  async searchFiles(searchTerm: string, mimeType?: string): Promise<DriveFile[]> {
    let query = `name contains '${searchTerm}'`;
    if (mimeType) {
      query += ` and mimeType='${mimeType}'`;
    }
    return this.listFiles(query, undefined, 100);
  }

  async readFile(fileId: string): Promise<string> {
    await this.ensureInitialized();

    try {
      // Get file metadata to determine type
      const metadata = await this.drive.files.get({
        fileId,
        fields: 'mimeType, name',
        supportsAllDrives: true,
      });

      const mimeType = metadata.data.mimeType;

      // Handle Google Docs
      if (mimeType === 'application/vnd.google-apps.document') {
        const response = await this.drive.files.export({
          fileId,
          mimeType: 'text/plain',
          supportsAllDrives: true,
        });
        return response.data;
      }

      // Handle Google Sheets
      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        const response = await this.drive.files.export({
          fileId,
          mimeType: 'text/csv',
          supportsAllDrives: true,
        });
        return response.data;
      }

      // Handle Google Slides (export as plain text)
      if (mimeType === 'application/vnd.google-apps.presentation') {
        const response = await this.drive.files.export({
          fileId,
          mimeType: 'text/plain',
          supportsAllDrives: true,
        });
        return response.data;
      }

      // Handle plain text and other downloadable files
      const response = await this.drive.files.get(
        {
          fileId,
          alt: 'media',
          supportsAllDrives: true,
        },
        { responseType: 'text' }
      );
      return response.data;
    } catch (error) {
      console.error('Error reading file:', error);
      throw error;
    }
  }

  async getFileRevisions(fileId: string, pageSize: number = 100): Promise<FileRevision[]> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.revisions.list({
        fileId,
        pageSize: Math.min(pageSize, 1000),
        fields: 'revisions(id, modifiedTime, lastModifyingUser, size, keepForever)',
        supportsAllDrives: true,
      });

      return response.data.revisions || [];
    } catch (error) {
      console.error('Error listing file revisions:', error);
      throw error;
    }
  }

  async readFileRevision(fileId: string, revisionId: string): Promise<string> {
    await this.ensureInitialized();

    try {
      // Get file metadata to determine type
      const metadata = await this.drive.files.get({
        fileId,
        fields: 'mimeType, name',
        supportsAllDrives: true,
      });

      const mimeType = metadata.data.mimeType;

      // Handle Google Docs
      if (mimeType === 'application/vnd.google-apps.document') {
        const response = await this.drive.revisions.get({
          fileId,
          revisionId,
          acknowledgeAbuse: true,
        });

        // Export the revision to plain text
        const exportResponse = await this.drive.files.export({
          fileId,
          mimeType: 'text/plain',
        });

        return `Revision ${revisionId} (Modified: ${response.data.modifiedTime})\n\n${exportResponse.data}`;
      }

      // Handle Google Sheets
      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        const response = await this.drive.revisions.get({
          fileId,
          revisionId,
          acknowledgeAbuse: true,
        });

        const exportResponse = await this.drive.files.export({
          fileId,
          mimeType: 'text/csv',
        });

        return `Revision ${revisionId} (Modified: ${response.data.modifiedTime})\n\n${exportResponse.data}`;
      }

      // Handle Google Slides
      if (mimeType === 'application/vnd.google-apps.presentation') {
        const response = await this.drive.revisions.get({
          fileId,
          revisionId,
          acknowledgeAbuse: true,
        });

        const exportResponse = await this.drive.files.export({
          fileId,
          mimeType: 'text/plain',
        });

        return `Revision ${revisionId} (Modified: ${response.data.modifiedTime})\n\n${exportResponse.data}`;
      }

      // For other file types, try to get the revision content
      const response = await this.drive.revisions.get(
        {
          fileId,
          revisionId,
          alt: 'media',
          acknowledgeAbuse: true,
        },
        { responseType: 'text' }
      );

      return response.data;
    } catch (error) {
      console.error('Error reading file revision:', error);
      throw error;
    }
  }

  async compareRevisions(
    fileId: string,
    revisionId1: string,
    revisionId2: string
  ): Promise<string> {
    await this.ensureInitialized();

    try {
      // Get both revision contents
      const [content1, content2, rev1, rev2] = await Promise.all([
        this.readFileRevision(fileId, revisionId1),
        this.readFileRevision(fileId, revisionId2),
        this.drive.revisions.get({ fileId, revisionId: revisionId1 }),
        this.drive.revisions.get({ fileId, revisionId: revisionId2 }),
      ]);

      // Simple line-based comparison
      const lines1 = content1.split('\n');
      const lines2 = content2.split('\n');

      let comparison = `Comparing revisions:\n`;
      comparison += `Revision ${revisionId1}: Modified ${rev1.data.modifiedTime}`;
      if (rev1.data.lastModifyingUser) {
        comparison += ` by ${rev1.data.lastModifyingUser.displayName}`;
      }
      comparison += `\nRevision ${revisionId2}: Modified ${rev2.data.modifiedTime}`;
      if (rev2.data.lastModifyingUser) {
        comparison += ` by ${rev2.data.lastModifyingUser.displayName}`;
      }
      comparison += `\n\n`;

      // Simple diff (this is basic - could be enhanced with a proper diff library)
      const maxLines = Math.max(lines1.length, lines2.length);
      let diffCount = 0;

      for (let i = 0; i < maxLines; i++) {
        const line1 = lines1[i] || '';
        const line2 = lines2[i] || '';

        if (line1 !== line2) {
          diffCount++;
          comparison += `\nLine ${i + 1} changed:\n`;
          comparison += `- ${line1}\n`;
          comparison += `+ ${line2}\n`;
        }
      }

      if (diffCount === 0) {
        comparison += `No differences found between these revisions.`;
      } else {
        comparison = `Found ${diffCount} differences:\n\n` + comparison;
      }

      return comparison;
    } catch (error) {
      console.error('Error comparing revisions:', error);
      throw error;
    }
  }

  // ========== Phase 5: Comments & Collaboration ==========

  async listComments(fileId: string, includeDeleted: boolean = false): Promise<FileComment[]> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.comments.list({
        fileId,
        fields: 'comments(id, content, author, createdTime, modifiedTime, resolved, quotedFileContent, replies)',
        includeDeleted,
        supportsAllDrives: true,
      });

      return response.data.comments || [];
    } catch (error) {
      console.error('Error listing comments:', error);
      throw error;
    }
  }

  async createComment(
    fileId: string,
    content: string,
    quotedText?: string
  ): Promise<FileComment> {
    await this.ensureInitialized();

    try {
      const commentBody: any = {
        content,
      };

      if (quotedText) {
        commentBody.quotedFileContent = {
          value: quotedText,
        };
      }

      const response = await this.drive.comments.create({
        fileId,
        requestBody: commentBody,
        fields: 'id, content, author, createdTime, modifiedTime, resolved',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error creating comment:', error);
      throw error;
    }
  }

  async resolveComment(fileId: string, commentId: string): Promise<FileComment> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.comments.update({
        fileId,
        commentId,
        requestBody: {
          resolved: true,
        },
        fields: 'id, content, author, createdTime, modifiedTime, resolved',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error resolving comment:', error);
      throw error;
    }
  }

  async unresolveComment(fileId: string, commentId: string): Promise<FileComment> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.comments.update({
        fileId,
        commentId,
        requestBody: {
          resolved: false,
        },
        fields: 'id, content, author, createdTime, modifiedTime, resolved',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error unresolving comment:', error);
      throw error;
    }
  }

  // ========== Phase 6: Advanced Search ==========

  async searchByOwner(ownerEmail: string, pageSize: number = 100): Promise<DriveFile[]> {
    const query = `'${ownerEmail}' in owners`;
    return this.listFiles(query, undefined, pageSize);
  }

  async searchByDateRange(
    startDate: string,
    endDate?: string,
    pageSize: number = 100
  ): Promise<DriveFile[]> {
    let query = `modifiedTime >= '${startDate}'`;
    if (endDate) {
      query += ` and modifiedTime <= '${endDate}'`;
    }
    return this.listFiles(query, undefined, pageSize);
  }

  async searchStarred(pageSize: number = 100): Promise<DriveFile[]> {
    const query = 'starred = true';
    return this.listFiles(query, undefined, pageSize);
  }

  async searchRecent(daysBack: number = 7, pageSize: number = 100): Promise<DriveFile[]> {
    const date = new Date();
    date.setDate(date.getDate() - daysBack);
    const dateStr = date.toISOString();
    const query = `modifiedTime >= '${dateStr}'`;
    return this.listFiles(query, undefined, pageSize);
  }

  async starFile(fileId: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.drive.files.update({
        fileId,
        requestBody: {
          starred: true,
        },
        supportsAllDrives: true,
      });
    } catch (error) {
      console.error('Error starring file:', error);
      throw error;
    }
  }

  async unstarFile(fileId: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.drive.files.update({
        fileId,
        requestBody: {
          starred: false,
        },
        supportsAllDrives: true,
      });
    } catch (error) {
      console.error('Error unstarring file:', error);
      throw error;
    }
  }

  // ========== Phase 2: Google Sheets Write ==========

  async updateCell(
    spreadsheetId: string,
    range: string,
    value: string
  ): Promise<any> {
    await this.ensureInitialized();

    try {
      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[value]],
        },
      });

      return response.data;
    } catch (error) {
      console.error('Error updating cell:', error);
      throw error;
    }
  }

  async appendRow(
    spreadsheetId: string,
    range: string,
    values: string[]
  ): Promise<any> {
    await this.ensureInitialized();

    try {
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [values],
        },
      });

      return response.data;
    } catch (error) {
      console.error('Error appending row:', error);
      throw error;
    }
  }

  async batchUpdateCells(
    spreadsheetId: string,
    updates: Array<{ range: string; values: string[][] }>
  ): Promise<any> {
    await this.ensureInitialized();

    try {
      const data = updates.map((update) => ({
        range: update.range,
        values: update.values,
      }));

      const response = await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data,
        },
      });

      return response.data;
    } catch (error) {
      console.error('Error batch updating cells:', error);
      throw error;
    }
  }

  async createSpreadsheet(title: string, sheetTitles?: string[]): Promise<any> {
    await this.ensureInitialized();

    try {
      const sheets = sheetTitles
        ? sheetTitles.map((title) => ({ properties: { title } }))
        : undefined;

      const response = await this.sheets.spreadsheets.create({
        requestBody: {
          properties: { title },
          sheets,
        },
      });

      return response.data;
    } catch (error) {
      console.error('Error creating spreadsheet:', error);
      throw error;
    }
  }

  async listSheets(spreadsheetId: string): Promise<any> {
    await this.ensureInitialized();

    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties',
      });

      const sheets = response.data.sheets || [];
      return sheets.map((sheet: any) => ({
        sheetId: sheet.properties.sheetId,
        title: sheet.properties.title,
        index: sheet.properties.index,
        sheetType: sheet.properties.sheetType || 'GRID',
        gridProperties: sheet.properties.gridProperties,
      }));
    } catch (error) {
      console.error('Error listing sheets:', error);
      throw error;
    }
  }

  async readSheet(spreadsheetId: string, sheetName?: string, range?: string): Promise<string> {
    await this.ensureInitialized();

    try {
      // If no sheet name provided, read all sheets
      if (!sheetName) {
        const sheets = await this.listSheets(spreadsheetId);
        let result = '';

        for (const sheet of sheets) {
          const sheetResult = await this.readSheetWithHyperlinks(spreadsheetId, sheet.title, range);
          result += `\n=== Sheet: ${sheet.title} ===\n`;
          result += sheetResult;
          result += '\n';
        }
        return result;
      }

      // Read specific sheet with hyperlinks
      return await this.readSheetWithHyperlinks(spreadsheetId, sheetName, range);
    } catch (error) {
      console.error('Error reading sheet:', error);
      throw error;
    }
  }

  private async readSheetWithHyperlinks(
    spreadsheetId: string,
    sheetName: string,
    range?: string
  ): Promise<string> {
    const sheetRange = range ? `${sheetName}!${range}` : sheetName;

    // Get cell values
    const valuesResponse = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetRange,
    });

    // Get cell formatting and hyperlinks
    const sheetResponse = await this.sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [sheetRange],
      fields: 'sheets(data(rowData(values(hyperlink,formattedValue))))',
    });

    const values = valuesResponse.data.values || [];
    const sheetData = sheetResponse.data.sheets?.[0]?.data?.[0];
    const rowData = sheetData?.rowData || [];

    let result = '';

    for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
      const row = values[rowIndex];
      const rowCells = rowData[rowIndex]?.values || [];
      const cellTexts = [];

      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const cellValue = row[colIndex];
        const cellData = rowCells[colIndex];
        const hyperlink = cellData?.hyperlink;

        if (hyperlink) {
          cellTexts.push(`${cellValue} [${hyperlink}]`);
        } else {
          cellTexts.push(cellValue);
        }
      }

      result += cellTexts.join('\t') + '\n';
    }

    return result;
  }

  // ========== Phase 3: File Management ==========

  async createFile(
    name: string,
    mimeType: string,
    content?: string,
    parentFolderId?: string
  ): Promise<DriveFile> {
    await this.ensureInitialized();

    try {
      const fileMetadata: any = {
        name,
        mimeType,
      };

      if (parentFolderId) {
        fileMetadata.parents = [parentFolderId];
      }

      let response;
      if (content && mimeType === 'application/vnd.google-apps.document') {
        // For Google Docs, create empty then update
        response = await this.drive.files.create({
          requestBody: fileMetadata,
          fields: 'id, name, mimeType, webViewLink',
        });
      } else if (content) {
        // For other files with content
        response = await this.drive.files.create({
          requestBody: fileMetadata,
          media: {
            mimeType: 'text/plain',
            body: content,
          },
          fields: 'id, name, mimeType, webViewLink',
        });
      } else {
        // Empty file
        response = await this.drive.files.create({
          requestBody: fileMetadata,
          fields: 'id, name, mimeType, webViewLink',
        });
      }

      return response.data;
    } catch (error) {
      console.error('Error creating file:', error);
      throw error;
    }
  }

  async uploadFile(
    localPath: string,
    name?: string,
    parentFolderId?: string
  ): Promise<DriveFile> {
    await this.ensureInitialized();

    try {
      // Read file from local path
      if (!fs.existsSync(localPath)) {
        throw new Error(`File not found: ${localPath}`);
      }

      const fileName = name || path.basename(localPath);

      // Detect MIME type based on extension
      const ext = path.extname(localPath).toLowerCase();
      const mimeTypes: { [key: string]: string } = {
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
      };

      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      const fileMetadata: any = {
        name: fileName,
      };

      if (parentFolderId) {
        fileMetadata.parents = [parentFolderId];
      }

      // Create a read stream for the file
      const fileStream = fs.createReadStream(localPath);

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType,
          body: fileStream,
        },
        fields: 'id, name, mimeType, webViewLink',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }

  async updateFileContent(
    fileId: string,
    localPath: string
  ): Promise<DriveFile> {
    await this.ensureInitialized();

    try {
      // Read file from local path
      if (!fs.existsSync(localPath)) {
        throw new Error(`File not found: ${localPath}`);
      }

      // Detect MIME type based on extension
      const ext = path.extname(localPath).toLowerCase();
      const mimeTypes: { [key: string]: string } = {
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.md': 'text/markdown',
      };

      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      // Create a read stream for the file
      const fileStream = fs.createReadStream(localPath);

      // Update file content using Drive API files.update with media
      const response = await this.drive.files.update({
        fileId,
        media: {
          mimeType,
          body: fileStream,
        },
        fields: 'id, name, mimeType, webViewLink, modifiedTime',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error updating file content:', error);
      throw error;
    }
  }

  async createFolder(name: string, parentFolderId?: string): Promise<DriveFile> {
    await this.ensureInitialized();

    try {
      const fileMetadata: any = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
      };

      if (parentFolderId) {
        fileMetadata.parents = [parentFolderId];
      }

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, mimeType, webViewLink',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  }

  async moveFile(fileId: string, newParentFolderId: string): Promise<DriveFile> {
    await this.ensureInitialized();

    try {
      // Get current parents
      const file = await this.drive.files.get({
        fileId,
        fields: 'parents',
        supportsAllDrives: true,
      });

      const previousParents = file.data.parents ? file.data.parents.join(',') : '';

      // Move file
      const response = await this.drive.files.update({
        fileId,
        addParents: newParentFolderId,
        removeParents: previousParents,
        fields: 'id, name, mimeType, webViewLink, parents',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error moving file:', error);
      throw error;
    }
  }

  async copyFile(fileId: string, newName?: string, parentFolderId?: string): Promise<DriveFile> {
    await this.ensureInitialized();

    try {
      const requestBody: any = {};

      if (newName) {
        requestBody.name = newName;
      }

      if (parentFolderId) {
        requestBody.parents = [parentFolderId];
      }

      const response = await this.drive.files.copy({
        fileId,
        requestBody,
        fields: 'id, name, mimeType, webViewLink',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error copying file:', error);
      throw error;
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.drive.files.delete({
        fileId,
        supportsAllDrives: true,
      });
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  }

  async updateFileMetadata(
    fileId: string,
    updates: {
      name?: string;
      description?: string;
      starred?: boolean;
    }
  ): Promise<DriveFile> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.files.update({
        fileId,
        requestBody: updates,
        fields: 'id, name, mimeType, description, starred, webViewLink',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error updating file metadata:', error);
      throw error;
    }
  }

  // ========== Phase 4: Sharing & Permissions ==========

  async shareFile(
    fileId: string,
    email: string,
    role: 'reader' | 'commenter' | 'writer',
    sendNotificationEmail: boolean = true
  ): Promise<FilePermission> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.permissions.create({
        fileId,
        requestBody: {
          type: 'user',
          role,
          emailAddress: email,
        },
        sendNotificationEmail,
        fields: 'id, type, role, emailAddress, displayName',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error sharing file:', error);
      throw error;
    }
  }

  async getPermissions(fileId: string): Promise<FilePermission[]> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.permissions.list({
        fileId,
        fields: 'permissions(id, type, role, emailAddress, displayName, domain)',
        supportsAllDrives: true,
      });

      return response.data.permissions || [];
    } catch (error) {
      console.error('Error getting permissions:', error);
      throw error;
    }
  }

  async updatePermission(
    fileId: string,
    permissionId: string,
    role: 'reader' | 'commenter' | 'writer'
  ): Promise<FilePermission> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.permissions.update({
        fileId,
        permissionId,
        requestBody: { role },
        fields: 'id, type, role, emailAddress, displayName',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error updating permission:', error);
      throw error;
    }
  }

  async deletePermission(fileId: string, permissionId: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.drive.permissions.delete({
        fileId,
        permissionId,
        supportsAllDrives: true,
      });
    } catch (error) {
      console.error('Error deleting permission:', error);
      throw error;
    }
  }

  async createPublicLink(
    fileId: string,
    role: 'reader' | 'commenter' | 'writer' = 'reader'
  ): Promise<{ link: string; permission: FilePermission }> {
    await this.ensureInitialized();

    try {
      const permission = await this.drive.permissions.create({
        fileId,
        requestBody: {
          type: 'anyone',
          role,
        },
        fields: 'id, type, role',
        supportsAllDrives: true,
      });

      const file = await this.drive.files.get({
        fileId,
        fields: 'webViewLink',
        supportsAllDrives: true,
      });

      return {
        link: file.data.webViewLink,
        permission: permission.data,
      };
    } catch (error) {
      console.error('Error creating public link:', error);
      throw error;
    }
  }

  // ========== Phase 7: File Metadata & Properties ==========

  async getFileMetadata(fileId: string): Promise<FileMetadata> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.files.get({
        fileId,
        fields:
          'id, name, mimeType, description, starred, createdTime, modifiedTime, size, webViewLink, owners, properties',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error getting file metadata:', error);
      throw error;
    }
  }

  async setCustomProperties(
    fileId: string,
    properties: { [key: string]: string }
  ): Promise<FileMetadata> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.files.update({
        fileId,
        requestBody: {
          properties,
        },
        fields:
          'id, name, mimeType, description, starred, createdTime, modifiedTime, size, webViewLink, properties',
        supportsAllDrives: true,
      });

      return response.data;
    } catch (error) {
      console.error('Error setting custom properties:', error);
      throw error;
    }
  }

  // ========== Phase 8: Export Options ==========

  async exportFile(
    fileId: string,
    mimeType: string
  ): Promise<string> {
    await this.ensureInitialized();

    try {
      // Check if file is a Google Workspace file
      const metadata = await this.drive.files.get({
        fileId,
        fields: 'mimeType',
        supportsAllDrives: true,
      });

      const originalMimeType = metadata.data.mimeType;

      // If it's a Google Workspace file, export it
      if (originalMimeType.startsWith('application/vnd.google-apps.')) {
        const response = await this.drive.files.export({
          fileId,
          mimeType,
          supportsAllDrives: true,
        });
        return response.data;
      } else {
        // For non-Google files, just download
        const response = await this.drive.files.get(
          {
            fileId,
            alt: 'media',
            supportsAllDrives: true,
          },
          { responseType: 'text' }
        );
        return response.data;
      }
    } catch (error) {
      console.error('Error exporting file:', error);
      throw error;
    }
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.files.get(
        {
          fileId,
          alt: 'media',
          supportsAllDrives: true,
        },
        { responseType: 'arraybuffer' }
      );

      return Buffer.from(response.data);
    } catch (error) {
      console.error('Error downloading file:', error);
      throw error;
    }
  }

  // ========== Phase 9: Batch Operations ==========

  async batchReadFiles(fileIds: string[]): Promise<Array<{ fileId: string; content: string; error?: string }>> {
    const results = [];

    for (const fileId of fileIds) {
      try {
        const content = await this.readFile(fileId);
        results.push({ fileId, content });
      } catch (error) {
        results.push({
          fileId,
          content: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  async batchGetMetadata(fileIds: string[]): Promise<Array<{ fileId: string; metadata?: FileMetadata; error?: string }>> {
    const results = [];

    for (const fileId of fileIds) {
      try {
        const metadata = await this.getFileMetadata(fileId);
        results.push({ fileId, metadata });
      } catch (error) {
        results.push({
          fileId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  // ========== Phase 10: Shared Drives ==========

  async listSharedDrives(pageSize: number = 100): Promise<SharedDrive[]> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.drives.list({
        pageSize: Math.min(pageSize, 100),
        fields: 'drives(id, name, createdTime, backgroundImageLink, capabilities)',
      });

      return response.data.drives || [];
    } catch (error) {
      console.error('Error listing shared drives:', error);
      throw error;
    }
  }

  async getSharedDrive(driveId: string): Promise<SharedDrive> {
    await this.ensureInitialized();

    try {
      const response = await this.drive.drives.get({
        driveId,
        fields: 'id, name, createdTime, backgroundImageLink, capabilities',
      });

      return response.data;
    } catch (error) {
      console.error('Error getting shared drive:', error);
      throw error;
    }
  }

  async listFilesInSharedDrive(
    driveId: string,
    query?: string,
    pageSize: number = 100
  ): Promise<DriveFile[]> {
    await this.ensureInitialized();

    try {
      let q = query || '';

      const response = await this.drive.files.list({
        pageSize: Math.min(pageSize, 1000),
        fields: 'files(id, name, mimeType, webViewLink, modifiedTime, size)',
        q: q || undefined,
        orderBy: 'modifiedTime desc',
        corpora: 'drive',
        driveId: driveId,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      });

      return response.data.files || [];
    } catch (error) {
      console.error('Error listing files in shared drive:', error);
      throw error;
    }
  }

  // ========== Phase 11: Drive Activity API ==========

  /**
   * Resolve a people resource name (e.g., "people/123456") to a display name
   * Uses caching to avoid repeated API calls
   */
  private async resolvePeopleName(resourceName: string): Promise<string> {
    // Check cache first
    if (this.peopleCache.has(resourceName)) {
      return this.peopleCache.get(resourceName)!;
    }

    try {
      const response = await this.people.people.get({
        resourceName,
        personFields: 'names,emailAddresses',
      });

      let displayName = resourceName; // fallback to ID
      if (response.data.names && response.data.names.length > 0) {
        displayName = response.data.names[0].displayName || resourceName;
      } else if (response.data.emailAddresses && response.data.emailAddresses.length > 0) {
        displayName = response.data.emailAddresses[0].value || resourceName;
      }

      this.peopleCache.set(resourceName, displayName);
      return displayName;
    } catch (error) {
      // If we can't resolve the name, cache and return the original ID
      this.peopleCache.set(resourceName, resourceName);
      return resourceName;
    }
  }

  /**
   * Batch resolve multiple people resource names to display names
   */
  private async resolvePeopleNames(resourceNames: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const toResolve: string[] = [];

    // Check cache first
    for (const name of resourceNames) {
      if (this.peopleCache.has(name)) {
        results.set(name, this.peopleCache.get(name)!);
      } else {
        toResolve.push(name);
      }
    }

    // Batch resolve uncached names (People API supports batch get)
    if (toResolve.length > 0) {
      try {
        const response = await this.people.people.getBatchGet({
          resourceNames: toResolve,
          personFields: 'names,emailAddresses',
        });

        if (response.data.responses) {
          for (const personResponse of response.data.responses) {
            if (personResponse.person) {
              const resourceName = personResponse.requestedResourceName || '';
              let displayName = resourceName;

              if (personResponse.person.names && personResponse.person.names.length > 0) {
                displayName = personResponse.person.names[0].displayName || resourceName;
              } else if (personResponse.person.emailAddresses && personResponse.person.emailAddresses.length > 0) {
                displayName = personResponse.person.emailAddresses[0].value || resourceName;
              }

              this.peopleCache.set(resourceName, displayName);
              results.set(resourceName, displayName);
            }
          }
        }
      } catch (error) {
        // If batch fails, fall back to individual resolution
        for (const name of toResolve) {
          const resolved = await this.resolvePeopleName(name);
          results.set(name, resolved);
        }
      }
    }

    // For any that weren't resolved, use the original ID
    for (const name of resourceNames) {
      if (!results.has(name)) {
        results.set(name, name);
      }
    }

    return results;
  }

  /**
   * Query recent drive activity across all files
   * @param options Query options
   * @returns Array of drive activities
   */
  async queryActivity(options: {
    pageSize?: number;
    filter?: string;
    ancestorName?: string;
    itemName?: string;
  } = {}): Promise<{ activities: DriveActivity[]; nextPageToken?: string }> {
    await this.ensureInitialized();

    try {
      const requestBody: any = {
        pageSize: options.pageSize || 50,
        consolidationStrategy: {
          legacy: {},
        },
      };

      if (options.filter) {
        requestBody.filter = options.filter;
      }

      if (options.ancestorName) {
        requestBody.ancestorName = options.ancestorName;
      }

      if (options.itemName) {
        requestBody.itemName = options.itemName;
      }

      const response = await this.driveactivity.activity.query({
        requestBody,
      });

      return {
        activities: response.data.activities || [],
        nextPageToken: response.data.nextPageToken,
      };
    } catch (error) {
      console.error('Error querying drive activity:', error);
      throw error;
    }
  }

  /**
   * Get recent activity with a friendly format
   * @param daysBack Number of days to look back (default: 7)
   * @param actionTypes Optional filter for action types (e.g., 'comment', 'edit', 'create')
   */
  async getRecentActivity(
    daysBack: number = 7,
    actionTypes?: string[]
  ): Promise<Array<{
    time: string;
    action: string;
    actor: string;
    target: string;
    targetId?: string;
    details?: any;
  }>> {
    await this.ensureInitialized();

    try {
      // Calculate time filter
      const startTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
      let filter = `time > ${startTime}`;

      // Add action type filter if specified
      if (actionTypes && actionTypes.length > 0) {
        const actionFilters = actionTypes.map(t => {
          const actionMap: { [key: string]: string } = {
            'comment': 'COMMENT',
            'create': 'CREATE',
            'edit': 'EDIT',
            'move': 'MOVE',
            'rename': 'RENAME',
            'delete': 'DELETE',
            'restore': 'RESTORE',
            'permission': 'PERMISSION_CHANGE',
          };
          return actionMap[t.toLowerCase()] || t.toUpperCase();
        });
        filter += ` AND detail.action_detail_case:(${actionFilters.join(' ')})`;
      }

      const result = await this.queryActivity({
        pageSize: 100,
        filter,
      });

      // Collect all people IDs to resolve in batch
      const peopleIds = new Set<string>();
      for (const activity of result.activities) {
        if (activity.actors) {
          for (const actor of activity.actors) {
            if (actor.user?.knownUser?.personName) {
              peopleIds.add(actor.user.knownUser.personName);
            }
          }
        }
        // Also collect mentioned users from comments
        const comment = activity.primaryActionDetail?.comment;
        if (comment?.mentionedUsers) {
          for (const user of comment.mentionedUsers) {
            if (user.knownUser?.personName) {
              peopleIds.add(user.knownUser.personName);
            }
          }
        }
        if (comment?.assignment?.assignedUser?.knownUser?.personName) {
          peopleIds.add(comment.assignment.assignedUser.knownUser.personName);
        }
      }

      // Batch resolve all people names
      const peopleNames = await this.resolvePeopleNames(Array.from(peopleIds));

      // Transform to friendly format
      return result.activities.map(activity => {
        // Determine action type
        let action = 'unknown';
        let details: any = undefined;
        const primaryAction = activity.primaryActionDetail;
        if (primaryAction) {
          if (primaryAction.create) action = 'create';
          else if (primaryAction.edit) action = 'edit';
          else if (primaryAction.move) action = 'move';
          else if (primaryAction.rename) {
            action = 'rename';
            details = primaryAction.rename;
          }
          else if (primaryAction.delete) action = 'delete';
          else if (primaryAction.restore) action = 'restore';
          else if (primaryAction.comment) {
            action = 'comment';
            // Resolve mentioned users in details
            const commentDetails: any = { ...primaryAction.comment };
            if (commentDetails.mentionedUsers) {
              commentDetails.mentionedUsers = commentDetails.mentionedUsers.map((u: any) => {
                const personName = u.knownUser?.personName;
                return personName ? peopleNames.get(personName) || personName : 'unknown';
              });
            }
            if (commentDetails.assignment?.assignedUser?.knownUser?.personName) {
              const personName = commentDetails.assignment.assignedUser.knownUser.personName;
              commentDetails.assignedTo = peopleNames.get(personName) || personName;
            }
            details = commentDetails;
          }
          else if (primaryAction.permissionChange) action = 'permission_change';
        }

        // Get actor (resolved to name)
        let actor = 'unknown';
        let isCurrentUser = false;
        if (activity.actors && activity.actors.length > 0) {
          const firstActor = activity.actors[0];
          if (firstActor.user?.knownUser) {
            const personName = firstActor.user.knownUser.personName || '';
            actor = peopleNames.get(personName) || personName || 'unknown';
            isCurrentUser = firstActor.user.knownUser.isCurrentUser || false;
            if (isCurrentUser) {
              actor += ' (you)';
            }
          }
        }

        // Get target
        let target = 'unknown';
        let targetId: string | undefined;
        if (activity.targets && activity.targets.length > 0) {
          const firstTarget = activity.targets[0];
          if (firstTarget.driveItem) {
            target = firstTarget.driveItem.title || 'unknown';
            // Extract file ID from name (format: items/FILE_ID)
            if (firstTarget.driveItem.name) {
              targetId = firstTarget.driveItem.name.replace('items/', '');
            }
          } else if (firstTarget.fileComment) {
            target = firstTarget.fileComment.parent?.title || 'unknown (comment)';
            if (firstTarget.fileComment.parent?.name) {
              targetId = firstTarget.fileComment.parent.name.replace('items/', '');
            }
          }
        }

        // Get time
        const time = activity.timestamp || activity.timeRange?.startTime || 'unknown';

        return {
          time,
          action,
          actor,
          target,
          targetId,
          details,
        };
      });
    } catch (error) {
      console.error('Error getting recent activity:', error);
      throw error;
    }
  }

  /**
   * Get recent comments across all files (convenience method)
   * @param daysBack Number of days to look back (default: 7)
   */
  async getRecentCommentActivity(daysBack: number = 7): Promise<Array<{
    time: string;
    actor: string;
    target: string;
    targetId?: string;
    commentType: string;
    mentionedUsers?: string[];
    assignedTo?: string;
  }>> {
    const activities = await this.getRecentActivity(daysBack, ['comment']);

    return activities.map(activity => {
      let commentType = 'comment';
      let mentionedUsers: string[] = [];
      let assignedTo: string | undefined;

      if (activity.details) {
        if (activity.details.post) {
          commentType = activity.details.post.subtype || 'post';
        } else if (activity.details.assignment) {
          commentType = 'assignment';
          assignedTo = activity.details.assignedTo;
        } else if (activity.details.suggestion) {
          commentType = activity.details.suggestion.subtype || 'suggestion';
        }

        // mentionedUsers is now already an array of resolved names (strings)
        if (activity.details.mentionedUsers && Array.isArray(activity.details.mentionedUsers)) {
          mentionedUsers = activity.details.mentionedUsers.filter((u: any) => typeof u === 'string');
        }
      }

      return {
        time: activity.time,
        actor: activity.actor,
        target: activity.target,
        targetId: activity.targetId,
        commentType,
        mentionedUsers: mentionedUsers.length > 0 ? mentionedUsers : undefined,
        assignedTo,
      };
    });
  }
}
