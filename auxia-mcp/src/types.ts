/**
 * Shared types for Auxia MCP server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';

// Re-export Tool type for consumers
export type { Tool };

/**
 * Authentication credentials
 */
export interface AuthCredentials {
  email: string;
  name: string;
  picture?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

/**
 * Stored session data
 */
export interface StoredSession {
  session_cookie: string;
  cookie_name: string;
  expires_at: string;
  email: string;
  name: string;
}

/**
 * Authentication result
 */
export interface AuthResult {
  credentials: AuthCredentials;
  sessionCookie: string;
  cookieName: string;
}

/**
 * Project data
 */
export interface Project {
  projectId: string;
  displayName: string;
  companyId?: number;
}

/**
 * Treatment data
 */
export interface Treatment {
  treatmentId: string;
  name: string;
  description?: string;
  isLive?: boolean;
  isPaused?: boolean;
  treatmentTypeId?: string;
  surfaceId?: string;
}

/**
 * Treatment preview (list view)
 */
export interface TreatmentPreview {
  treatmentId: string;
  name: string;
  isPaused?: boolean;
  treatmentTypeName?: string;
  surfaces?: string[];
  state?: string;
  _searchText?: string; // Internal: concatenated searchable fields (not returned to client)
}

/**
 * Surface data
 */
export interface Surface {
  surfaceId: string;
  projectId: string;
  surfaceName: string;
}

/**
 * Objective data (summarized for MCP)
 */
export interface Objective {
  objectiveId: string;
  name: string;
  description?: string;
}

/**
 * Treatment type data
 */
export interface TreatmentType {
  id: string;
  name: string;
}

/**
 * Data field data (summarized for MCP)
 */
export interface DataField {
  dataFieldId: string;
  dataFieldName: string;
  dataFieldType?: string;
  isUserAttribute?: boolean;
  isDerived?: boolean;
  description?: string;
}

/**
 * Tool handler function type
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

/**
 * Tool definition with handler
 */
export interface ToolDefinition {
  tool: Tool;
  handler: ToolHandler;
}

/**
 * Tool execution context - provides access to shared state
 */
export interface ToolContext {
  getSessionCookie: () => string;
  setSessionCookie: (cookie: string) => void;
  getCurrentUser: () => { email: string; name: string } | null;
  setCurrentUser: (user: { email: string; name: string } | null) => void;
  getBFFClient: () => BFFClientInterface | null;
  setBFFClient: (client: BFFClientInterface | null) => void;
  initializeBFFClient: () => Promise<void>;
}

/**
 * BFF Client interface for dependency injection
 */
export interface BFFClientInterface {
  setSessionCookie(cookie: string): void;
  getSessionCookie(): string;
  setActiveProject(projectId: string): void;
  getActiveProjectId(): string;
  getProjects(): Promise<Project[]>;
  getTreatments(options?: { includeArchived?: boolean }): Promise<TreatmentPreview[]>;
  getTreatment(treatmentId: string): Promise<Treatment | null>;
  getTreatmentTypes(): Promise<TreatmentType[]>;
  getSurfaces(): Promise<Surface[]>;
  getObjectives(): Promise<Objective[]>;
  getDataFields(): Promise<DataField[]>;
  close(): void;
}

/**
 * Tool result type
 */
export interface ToolResult {
  content: Array<{ type: string; text: string }>;
}
