/**
 * HTTP client for the canonical /api/v1 routes.
 *
 * Calls the running Context Store app over HTTP using the connection bearer token.
 * Never imports internal app services — the API surface is the contract.
 */

import { ApiError } from "../errors.js";
import type { McpConfig } from "../config.js";

// ─── Shared fetch helper ──────────────────────────────────────────────────────

async function apiFetch<T>(
  config: McpConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${config.apiBaseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.connectionSecret}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(`API returned non-JSON response (HTTP ${res.status}) for ${path}`);
  }

  if (!res.ok) {
    const errBody = json as { error_code?: string; message?: string };
    throw new ApiError(res.status, {
      error_code: errBody.error_code ?? "unknown",
      message: errBody.message ?? `HTTP ${res.status}`,
    });
  }

  return (json as { data: T }).data;
}

// ─── Response types (mirror the canonical API response shapes) ────────────────

export interface BoxSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  guide_note_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteDetail {
  id: string;
  box_id: string;
  folder_id: string | null;
  title: string;
  slug: string;
  path_cache: string | null;
  markdown_content: string | null;
  summary: string | null;
  tags: string[];
  read_hint: string | null;
  kind: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface NoteSummary {
  id: string;
  box_id: string;
  folder_id: string | null;
  title: string;
  slug: string;
  path_cache: string | null;
  summary: string | null;
  tags: string[];
  read_hint: string | null;
  kind: string;
  status: string;
  updated_at: string;
}

export interface FolderSummary {
  id: string;
  name: string;
  slug: string;
  path_cache: string | null;
  description: string | null;
  accepts_generated_notes: boolean;
  parent_folder_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderContents {
  box_id: string;
  folder_id: string | null;
  folders: FolderSummary[];
  notes: NoteSummary[];
}

export interface BoxGuideResponse {
  box_id: string;
  guide_note: NoteDetail | null;
}

export interface OverviewNode {
  id: string;
  kind: "folder" | "note";
  label: string;
  path: string | null;
  noteKind?: string;
  parentFolderId?: string | null;
  parentId?: string | null;
}

export interface OverviewEdge {
  id: string;
  sourceNoteId: string;
  targetNoteId: string;
  relationshipType: string;
}

export interface BoxOverview {
  box: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    guide_note_id: string | null;
  };
  nodes: OverviewNode[];
  edges: OverviewEdge[];
  folder_count: number;
  note_count: number;
  edge_count: number;
  truncated: boolean;
}

export interface NoteLink {
  id: string;
  source_note_id: string;
  target_note_id: string;
  relationship_type: string;
  direction: "outgoing" | "incoming";
}

export interface LinkedNotes {
  note_id: string;
  links: NoteLink[];
  notes: NoteSummary[];
}

export interface SearchResultItem {
  id: string;
  box_id: string;
  folder_id: string | null;
  title: string;
  slug: string;
  path_cache: string | null;
  summary: string | null;
  tags: string[];
  read_hint: string | null;
  kind: string;
  status: string;
  updated_at: string;
  rank: number;
}

export interface SearchResult {
  box_id: string;
  query: string;
  limit: number;
  results: SearchResultItem[];
}

export interface ContextBundleOptions {
  note_id: string;
  include_guide?: boolean;
  include_ancestor_summary?: boolean;
  include_archived?: boolean;
  linked_limit?: number;
}

// ─── API client factory ───────────────────────────────────────────────────────

export function createApiClient(config: McpConfig) {
  const get = <T>(path: string) => apiFetch<T>(config, "GET", path);
  const post = <T>(path: string, body: unknown) =>
    apiFetch<T>(config, "POST", path, body);

  return {
    getSystemGuide: () => get<Record<string, unknown>>("/api/v1/system_guide"),

    listBoxes: () => get<BoxSummary[]>("/api/v1/boxes"),

    getBoxGuide: (box_id: string) =>
      get<BoxGuideResponse>(`/api/v1/boxes/${encodeURIComponent(box_id)}/box_guide`),

    getBoxOverview: (box_id: string) =>
      get<BoxOverview>(`/api/v1/boxes/${encodeURIComponent(box_id)}/box_overview`),

    listFolderContents: (box_id: string, folder_id?: string | null) => {
      const qs =
        folder_id != null
          ? `?folder_id=${encodeURIComponent(folder_id)}`
          : "";
      return get<FolderContents>(
        `/api/v1/boxes/${encodeURIComponent(box_id)}/folder_contents${qs}`
      );
    },

    getNote: (note_id: string) =>
      get<NoteDetail>(`/api/v1/notes/${encodeURIComponent(note_id)}`),

    getLinkedNotes: (note_id: string) =>
      get<LinkedNotes>(
        `/api/v1/notes/${encodeURIComponent(note_id)}/linked_notes`
      ),

    searchNotes: (box_id: string, query: string, limit: number) =>
      post<SearchResult>("/api/v1/search_notes", { box_id, query, limit }),

    getContextBundle: (opts: ContextBundleOptions) =>
      post<Record<string, unknown>>("/api/v1/context_bundles", opts),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
