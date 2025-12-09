/**
 * BFF HTTP Client for Auxia MCP server.
 *
 * Connects to the Auxia Console via the Next.js executeRpc endpoint.
 * Uses session cookies for authentication.
 */

import type {
  AuthCredentials,
  BFFClientInterface,
  DataField,
  Objective,
  Project,
  Surface,
  Treatment,
  TreatmentPreview,
  TreatmentType,
} from './types.js';

// BFF configuration
const CONSOLE_URL = process.env.CONSOLE_URL || 'https://console.auxia.io';
const EXECUTE_RPC_PATH = '/api/executeRpc';

/**
 * RPC IDs matching the frontend definitions in dataService/rpc_ids.ts
 */
const RpcIds = {
  GET_PROJECTS: 'GetProjectsBff',
  GET_PROJECT: 'GetProjectBff',
  GET_TREATMENTS: 'GetTreatmentsBff',
  GET_TREATMENT: 'GetTreatmentBff',
  LIST_TREATMENTS_PREVIEW: 'ListTreatmentsPreviewBff',
  GET_TREATMENT_TYPES: 'GetTreatmentTypesBff',
  GET_CONSOLE_USER: 'GetConsoleUserBff',
  LIST_SURFACES: 'ListSurfacesBff',
  GET_OBJECTIVES: 'GetObjectivesBff',
  GET_DATA_FIELDS: 'GetDataFieldsBff',
} as const;

/**
 * Parses a string ID to a number, with validation
 */
function parseNumericId(value: string, fieldName: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid ${fieldName}: must be a numeric value`);
  }
  return parsed;
}

/**
 * Protocol types matching dataService/protocol.ts
 */
interface RpcRequest {
  format: 'array' | 'binary';
  id: string;
  activeProjectId?: string;
  input: unknown[] | string;
  rpcDeadlineSeconds?: number;
}

interface RpcResponseSuccess {
  format: 'array' | 'binary';
  code: 0;
  output: unknown[] | string;
}

interface RpcResponseError {
  format: 'array' | 'binary';
  code: number;
  details: string;
  shouldLogOut?: boolean;
}

type RpcResponse = RpcResponseSuccess | RpcResponseError;

export interface BFFClientOptions {
  credentials: AuthCredentials;
  activeProjectId?: string;
  sessionCookie?: string;
}

/**
 * BFF HTTP Client
 *
 * Makes RPC calls through the Next.js executeRpc endpoint.
 * Authentication is handled via session cookies.
 */
export class BFFClient implements BFFClientInterface {
  private credentials: AuthCredentials;
  private activeProjectId: string;
  private sessionCookie: string;

  constructor(options: BFFClientOptions) {
    this.credentials = options.credentials;
    this.activeProjectId = options.activeProjectId || '';
    this.sessionCookie = options.sessionCookie || '';
  }

  /**
   * Sets the session cookie for authentication
   */
  setSessionCookie(cookie: string): void {
    this.sessionCookie = cookie;
  }

  /**
   * Gets the current session cookie
   */
  getSessionCookie(): string {
    return this.sessionCookie;
  }

  /**
   * Sets the active project ID
   */
  setActiveProject(projectId: string): void {
    this.activeProjectId = projectId;
  }

  /**
   * Gets the active project ID
   */
  getActiveProjectId(): string {
    return this.activeProjectId;
  }

  /**
   * Makes an RPC call to the BFF
   */
  private async callRpc<T>(rpcId: string, input: unknown[], activeProjectId?: string): Promise<T> {
    if (!this.sessionCookie) {
      throw new Error('No session cookie set. Please authenticate first.');
    }

    const request: RpcRequest = {
      format: 'array',
      id: rpcId,
      input,
      activeProjectId: activeProjectId || this.activeProjectId || undefined,
    };

    // The executeRpc endpoint expects multipart form data with 'requestPayload' field
    const formData = new FormData();
    formData.append('requestPayload', JSON.stringify(request));

    const headers: Record<string, string> = {
      'Cookie': this.sessionCookie,
    };

    const url = `${CONSOLE_URL}${EXECUTE_RPC_PATH}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP error ${response.status}: ${response.statusText}\n${text}`);
    }

    const result = (await response.json()) as RpcResponse;

    if (result.code !== 0) {
      const errorResult = result as RpcResponseError;
      if (errorResult.shouldLogOut) {
        throw new Error(`Session expired: ${errorResult.details}. Please re-authenticate.`);
      }
      throw new Error(`RPC error (code ${errorResult.code}): ${errorResult.details}`);
    }

    return (result as RpcResponseSuccess).output as T;
  }

  /**
   * Gets the list of projects the user has access to
   */
  async getProjects(): Promise<Project[]> {
    const response = await this.callRpc<unknown[]>(RpcIds.GET_PROJECTS, []);
    const projectsArray = (response[0] as unknown[][]) || [];

    return projectsArray.map((p: unknown[]) => ({
      projectId: String(p[0] || ''),
      displayName: String(p[1] || ''),
      companyId: Number(p[0]) || undefined,
    }));
  }

  /**
   * Gets treatments for the active project using ListTreatmentsPreview
   *
   * ListTreatmentsPreviewRequest proto:
   * field 1: string project_id
   * field 2: repeated Filters filters
   *   - Filters.include_archived = field 5 (idx 4)
   *
   * TreatmentPreviewModelPb proto fields (jspb index = field_number - 1):
   * field 1 (idx 0): int64 treatment_id
   * field 2 (idx 1): string treatment_name
   * field 3 (idx 2): bool is_paused
   * field 4 (idx 3): string treatment_type_name
   * field 5 (idx 4): string draft_version_display_string
   * field 6 (idx 5): optional Timestamp last_published_timestamp
   * field 7 (idx 6): optional string last_published_version_name
   * field 8 (idx 7): repeated string tags
   * field 9 (idx 8): repeated string surfaces
   * field 10 (idx 9): State state (enum: 0=UNSPECIFIED, 1=LIVE, 2=DRAFT, 3=ARCHIVED, 4=PAUSED)
   * field 18 (idx 17): repeated string universe_names
   * field 19 (idx 18): repeated string objective_names
   */
  async getTreatments(options: { includeArchived?: boolean } = {}): Promise<TreatmentPreview[]> {
    // Map state enum values to readable strings (from treatment.proto State enum)
    const stateMap: Record<number, string> = {
      0: 'UNSPECIFIED',
      1: 'LIVE',
      2: 'DRAFT',
      3: 'ARCHIVED',
      4: 'PAUSED',
    };
    if (!this.activeProjectId) {
      throw new Error('No active project set. Call setActiveProject() first.');
    }

    // Build filters array - each filter is a jspb array with field at index (field_number - 1)
    // include_archived is field 5, so it goes at index 4
    const filters: unknown[][] = [];
    if (options.includeArchived) {
      const includeArchivedFilter = [null, null, null, null, true]; // field 5 = index 4
      filters.push(includeArchivedFilter);
    }

    const input = [
      this.activeProjectId,
      filters,
    ];

    const response = await this.callRpc<unknown[]>(RpcIds.LIST_TREATMENTS_PREVIEW, input);
    const treatmentsArray = (response[0] as unknown[][]) || [];

    return treatmentsArray.map((t: unknown[]) => {
      // Parse surfaces array (field 9, index 8)
      let surfaces: string[] = [];
      if (Array.isArray(t[8])) {
        surfaces = (t[8] as unknown[]).map((s) => String(s));
      } else if (t[8]) {
        const surfaceStr = String(t[8]);
        if (surfaceStr) {
          surfaces = surfaceStr.split(',').filter((s) => s.trim());
        }
      }

      // Parse tags array (field 8, index 7)
      let tags: string[] = [];
      if (Array.isArray(t[7])) {
        tags = (t[7] as unknown[]).map((s) => String(s));
      }

      // Parse objective_names array (field 19, index 18)
      let objectiveNames: string[] = [];
      if (Array.isArray(t[18])) {
        objectiveNames = (t[18] as unknown[]).map((s) => String(s));
      }

      // Build searchable text from all text fields for filtering
      const searchableFields = [
        t[1], // treatment_name
        t[3], // treatment_type_name
        ...tags,
        ...objectiveNames,
      ].filter(Boolean).map(String);

      // Map state enum to string
      const stateNum = typeof t[9] === 'number' ? t[9] : parseInt(String(t[9]), 10);
      const stateStr = stateMap[stateNum] || (t[9] ? String(t[9]) : undefined);

      return {
        treatmentId: String(t[0] || ''),
        name: String(t[1] || ''),
        isPaused: Boolean(t[2]),
        treatmentTypeName: t[3] ? String(t[3]) : undefined,
        surfaces: surfaces.length > 0 ? surfaces : undefined,
        state: stateStr,
        _searchText: searchableFields.join(' ').toLowerCase(), // Internal field for search
      };
    });
  }

  /**
   * Gets a specific treatment by ID
   */
  async getTreatment(treatmentId: string): Promise<Treatment | null> {
    if (!this.activeProjectId) {
      throw new Error('No active project set. Call setActiveProject() first.');
    }

    // GetTreatmentRequest only has treatment_id (string) as field 1
    const input = [treatmentId];

    try {
      const response = await this.callRpc<unknown[]>(RpcIds.GET_TREATMENT, input);
      const treatment = response[0] as unknown[];
      if (!treatment) {
        return null;
      }

      return {
        treatmentId: String(treatment[0] || ''),
        name: String(treatment[1] || ''),
        description: String(treatment[2] || ''),
        isLive: Boolean(treatment[3]),
        isPaused: Boolean(treatment[4]),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('NOT_FOUND')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Gets treatment types for the active project
   *
   * The jspb array format creates deeply nested arrays that get stringified.
   * We parse the stringified representation to extract id and name.
   * Pattern: "treatment_type_id,project_id,name,delivery_type,..."
   */
  async getTreatmentTypes(): Promise<TreatmentType[]> {
    if (!this.activeProjectId) {
      throw new Error('No active project set. Call setActiveProject() first.');
    }

    const input = [parseNumericId(this.activeProjectId, 'project ID')];
    const response = await this.callRpc<unknown[]>(RpcIds.GET_TREATMENT_TYPES, input);
    const typesArray = (response[0] as unknown[][]) || [];

    return typesArray.map((t: unknown[]) => {
      // The nested TreatmentTypePb is at t[0]
      // When stringified it becomes: "id,project_id,name,delivery_type,..."
      const inner = t[0];
      const str = String(inner);
      const parts = str.split(',');

      // parts[0] = treatment_type_id
      // parts[1] = project_id
      // parts[2] = name (e.g., "CTA_NEXT_BEST_ACTION")
      return {
        id: parts[0] || '',
        name: parts[2] || '',
      };
    });
  }

  /**
   * Gets surfaces for the active project
   *
   * ListSurfacesRequest: [] (uses activeProjectId from context)
   * ListSurfacesResponse: [surfaces: [[surface_id, project_id, surface_name], ...]]
   */
  async getSurfaces(): Promise<Surface[]> {
    if (!this.activeProjectId) {
      throw new Error('No active project set. Call setActiveProject() first.');
    }

    // ListSurfacesRequest has no fields - project comes from activeProjectId
    const response = await this.callRpc<unknown[]>(RpcIds.LIST_SURFACES, []);
    const surfacesArray = (response[0] as unknown[][]) || [];

    return surfacesArray.map((s: unknown[]) => ({
      surfaceId: String(s[0] || ''),
      projectId: String(s[1] || ''),
      surfaceName: String(s[2] || ''),
    }));
  }

  /**
   * Gets objectives for the active project
   *
   * GetObjectivesRequest: [] (uses activeProjectId from context)
   * GetObjectivesResponse: [models: [[metadata: [objective_id, name, description, ...], ...], ...]]
   *
   * Returns summarized objective data (id, name, description only)
   */
  async getObjectives(): Promise<Objective[]> {
    if (!this.activeProjectId) {
      throw new Error('No active project set. Call setActiveProject() first.');
    }

    // GetObjectivesRequest has no fields - project comes from activeProjectId
    const response = await this.callRpc<unknown[]>(RpcIds.GET_OBJECTIVES, []);
    const modelsArray = (response[0] as unknown[][]) || [];

    // Each model is ObjectiveEditModelPb with structure:
    // [etag, metadata: [objective_id, name, description, ...], ...]
    // We extract just the metadata for a concise summary
    return modelsArray.map((m: unknown[]) => {
      // metadata is field 2 (index 1) in ObjectiveEditModelPb
      const metadata = (m[1] as unknown[]) || [];
      return {
        objectiveId: String(metadata[0] || ''),
        name: String(metadata[1] || ''),
        description: String(metadata[2] || ''),
      };
    });
  }

  /**
   * Gets data fields for the active project
   *
   * GetDataFieldsRequest: [company_id, read_mask]
   * GetDataFieldsResponse: [data_fields: [[data_field_id, name, ...], ...]]
   *
   * Returns summarized data field info (id, name, type, flags)
   * This is designed to be concise since data fields can be numerous
   */
  async getDataFields(): Promise<DataField[]> {
    if (!this.activeProjectId) {
      throw new Error('No active project set. Call setActiveProject() first.');
    }

    // GetDataFieldsRequest: [company_id, read_mask]
    // read_mask is optional - we'll pass empty for all fields
    const input = [this.activeProjectId];
    const response = await this.callRpc<unknown[]>(RpcIds.GET_DATA_FIELDS, input);
    const fieldsArray = (response[0] as unknown[][]) || [];

    // DataFieldPb structure:
    // [data_field_id, data_field_name, event_id/user_property_name, ..., data_field_type, ...]
    // We extract key fields and summarize
    return fieldsArray.map((f: unknown[]) => ({
      dataFieldId: String(f[0] || ''),
      dataFieldName: String(f[1] || ''),
      // field 5 is data_field_type (enum)
      dataFieldType: f[5] !== undefined ? String(f[5]) : undefined,
      // We can infer some flags from the structure
      isDerived: Boolean(f[7]),
      description: f[9] ? String(f[9]) : undefined,
    }));
  }

  /**
   * Closes the client (no-op for HTTP client)
   */
  close(): void {
    // No persistent connection to close
  }
}

/**
 * Creates a BFF client
 */
export async function createBFFClient(options: BFFClientOptions): Promise<BFFClient> {
  return new BFFClient(options);
}
