import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_CREDENTIALS } from './credentials.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export class GoogleDriveClient {
  private auth: OAuth2Client | null = null;
  private drive: any = null;
  private sheets: any = null;

  constructor() {
    this.initializeAuth();
  }

  private async initializeAuth() {
    try {
      // Use embedded credentials (can be overridden with env var or file)
      let credentials = DEFAULT_CREDENTIALS;

      const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH ||
                             path.join(process.env.HOME || '', 'Claude', 'gdrive-credentials.json');

      if (fs.existsSync(credentialsPath)) {
        // Override with custom credentials if file exists
        credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
      }

      // Check if we have a token file
      const tokenPath = process.env.GOOGLE_TOKEN_PATH ||
                       path.join(process.env.HOME || '', 'Claude', '.security', 'gdrive-token.json');

      let token = null;
      if (fs.existsSync(tokenPath)) {
        token = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
      }

      // Initialize OAuth2 client
      this.auth = new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        credentials.redirect_uri
      );

      if (token) {
        this.auth.setCredentials(token);
      } else {
        // __dirname is build/, so go up one level to get project root
        const projectDir = path.resolve(__dirname, '..');
        throw new Error(
          `Google Drive not authenticated. Ask Claude to run: cd ${projectDir} && npm run auth`
        );
      }

      // Initialize Drive API
      this.drive = google.drive({ version: 'v3', auth: this.auth });
      // Initialize Sheets API
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    } catch (error) {
      console.error('Failed to initialize Google Drive client:', error);
      throw error;
    }
  }

  async listFiles(
    query?: string,
    folderId?: string,
    pageSize: number = 100
  ): Promise<DriveFile[]> {
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.sheets) {
      throw new Error('Google Sheets client not initialized');
    }

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
    if (!this.sheets) {
      throw new Error('Google Sheets client not initialized');
    }

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
    if (!this.sheets) {
      throw new Error('Google Sheets client not initialized');
    }

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
    if (!this.sheets) {
      throw new Error('Google Sheets client not initialized');
    }

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
    if (!this.sheets) {
      throw new Error('Google Sheets client not initialized');
    }

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
    if (!this.sheets) {
      throw new Error('Google Sheets client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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

  async createFolder(name: string, parentFolderId?: string): Promise<DriveFile> {
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
    if (!this.drive) {
      throw new Error('Google Drive client not initialized');
    }

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
}
