import { type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { logger } from "@/lib/logger";
import { ValidationError } from "@/server/domain/errors";
import { RepositoryError } from "@/server/domain/errors";
import { generateEmbedding } from "@/server/services/embedding_service";
import {
  parseTranscript,
  totalTokens,
  type ParsedSegment,
  type TranscriptFormat,
} from "@/server/services/transcript_parser";
import { getSessionById } from "@/server/repositories/agent_session_repository";

/**
 * Transcript ingest and retrieval — the conversation layer.
 *
 * The event log answers "what did the last agent conclude". This answers
 * "show me what it actually said, in context". Both are needed: a conclusion
 * routes the next agent, but only the conversation explains why three
 * approaches were abandoned, and that is the expensive thing to rediscover.
 *
 * Three properties this service holds:
 *
 *   INCREMENTAL. A live transcript is a file being appended to. We track a byte
 *   cursor per session and parse only what is new. Shipping megabytes on every
 *   PreCompact would be absurd; shipping the delta is cheap enough to do often.
 *
 *   APPEND-ONLY AND GAP-FREE. Segment ordinals are dense and monotonic, which
 *   is what makes "read the 8 segments around this hit" a range scan. A
 *   re-sent chunk is ignored rather than duplicated.
 *
 *   DEGRADES TO KEYWORD. Embeddings are optional and asynchronous. Search runs
 *   on Postgres FTS the moment a segment lands, and gets better when the
 *   embedding backfill catches up. A deployment with no EMBEDDING_API_KEY has
 *   working search, not broken search.
 */

// ─── Ingest ─────────────────────────────────────────────────────────────────

export interface IngestTranscriptRequest {
  /** Raw transcript bytes, starting at `from_offset` in the source file. */
  content: string;
  format?: TranscriptFormat;
  /**
   * Byte offset in the source file this chunk starts at. Used to detect and
   * ignore a chunk the client has already delivered.
   */
  from_offset?: number;
}

export interface IngestTranscriptResult {
  transcript_id: string;
  segments_added: number;
  segment_count: number;
  /** Byte offset the client should send from next time. */
  next_offset: number;
  skipped: boolean;
}

/** Max bytes accepted in one chunk. Keeps a single request bounded. */
export const MAX_TRANSCRIPT_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * Fetch or create the transcript row for a session.
 *
 * Created lazily on first ingest rather than alongside the session: most
 * sessions in a mixed fleet never ship a transcript at all, and an empty row
 * per session would be pure noise in the UI.
 */
async function ensureTranscript(
  client: SupabaseClient,
  session: { id: string; workspace_id: string; project_id: string },
  format: TranscriptFormat
): Promise<{
  id: string;
  segment_count: number;
  last_ingested_offset: number;
  byte_count: number;
  message_count: number;
  token_estimate: number;
}> {
  const { data: existing, error: readError } = await client
    .from("session_transcripts")
    .select("id, segment_count, last_ingested_offset, byte_count, message_count, token_estimate")
    .eq("session_id", session.id)
    .maybeSingle();

  if (readError) {
    throw new RepositoryError(`Failed to load transcript: ${readError.message}`);
  }
  if (existing) return existing;

  const { data, error } = await client
    .from("session_transcripts")
    .insert({
      workspace_id: session.workspace_id,
      project_id: session.project_id,
      session_id: session.id,
      source_format: format,
    })
    .select("id, segment_count, last_ingested_offset, byte_count, message_count, token_estimate")
    .single();

  if (error) {
    // Lost a race with a concurrent first chunk — its row is as good as ours.
    if (error.code === "23505") {
      const { data: raced } = await client
        .from("session_transcripts")
        .select("id, segment_count, last_ingested_offset, byte_count, message_count, token_estimate")
        .eq("session_id", session.id)
        .maybeSingle();
      if (raced) return raced;
    }
    throw new RepositoryError(`Failed to create transcript: ${error.message}`);
  }

  return data;
}

/**
 * Ingest a chunk of transcript.
 *
 * Idempotency is by byte offset rather than a content hash: a client that
 * re-sends the same chunk after a timeout carries the same `from_offset`, and
 * a client that has fallen behind sends an earlier one. Both are handled by
 * comparing against the stored cursor, so a retry never duplicates segments and
 * never silently skips content.
 */
export async function ingestTranscriptChunk(
  client: SupabaseClient,
  workspaceId: string,
  sessionId: string,
  request: IngestTranscriptRequest
): Promise<IngestTranscriptResult> {
  const session = await getSessionById(client, sessionId);
  if (!session || session.workspace_id !== workspaceId) {
    throw new ValidationError(`Session ${sessionId} not found`);
  }

  const content = request.content ?? "";
  if (Buffer.byteLength(content, "utf8") > MAX_TRANSCRIPT_CHUNK_BYTES) {
    throw new ValidationError(
      `Transcript chunk exceeds ${MAX_TRANSCRIPT_CHUNK_BYTES} bytes; send it in smaller pieces`
    );
  }

  const format = request.format ?? "plain";
  const transcript = await ensureTranscript(client, session, format);

  const fromOffset = Math.max(0, Math.floor(request.from_offset ?? 0));

  // The client is behind our cursor: it is replaying content we already have.
  // Tell it where to resume rather than re-parsing.
  if (fromOffset < transcript.last_ingested_offset) {
    return {
      transcript_id: transcript.id,
      segments_added: 0,
      segment_count: transcript.segment_count,
      next_offset: transcript.last_ingested_offset,
      skipped: true,
    };
  }

  // The client is ahead of our cursor: it skipped bytes we never saw. We accept
  // the chunk (a hole beats losing everything after it) but the cursor jumps,
  // so the gap is recorded in the offset rather than silently papered over.
  if (fromOffset > transcript.last_ingested_offset && transcript.last_ingested_offset > 0) {
    logger.warn(
      {
        sessionId,
        expected: transcript.last_ingested_offset,
        received: fromOffset,
      },
      "Transcript chunk skipped bytes; accepting with a gap"
    );
  }

  const parsed = parseTranscript(content, format);
  if (parsed.segments.length === 0) {
    return {
      transcript_id: transcript.id,
      segments_added: 0,
      segment_count: transcript.segment_count,
      next_offset: fromOffset + parsed.consumedBytes,
      skipped: false,
    };
  }

  const rows = parsed.segments.map((segment: ParsedSegment, index: number) => ({
    workspace_id: session.workspace_id,
    project_id: session.project_id,
    session_id: session.id,
    transcript_id: transcript.id,
    ordinal: transcript.segment_count + index,
    role: segment.role,
    kind: segment.kind,
    content: segment.content,
    token_estimate: segment.token_estimate,
    tool_name: segment.tool_name,
    files: segment.files,
    importance: segment.importance,
    truncated: segment.truncated,
    occurred_at: segment.occurred_at ?? new Date().toISOString(),
  }));

  const { error: insertError } = await client
    .from("transcript_segments")
    .insert(rows);

  if (insertError) {
    // A unique violation on (transcript_id, ordinal) means a concurrent chunk
    // claimed these ordinals. The client should re-send from our cursor.
    if (insertError.code === "23505") {
      const { data: current } = await client
        .from("session_transcripts")
        .select("segment_count, last_ingested_offset")
        .eq("id", transcript.id)
        .maybeSingle();
      return {
        transcript_id: transcript.id,
        segments_added: 0,
        segment_count: current?.segment_count ?? transcript.segment_count,
        next_offset: current?.last_ingested_offset ?? transcript.last_ingested_offset,
        skipped: true,
      };
    }
    throw new RepositoryError(
      `Failed to insert transcript segments: ${insertError.message}`
    );
  }

  const nextOffset = fromOffset + parsed.consumedBytes;

  const { error: updateError } = await client
    .from("session_transcripts")
    .update({
      segment_count: transcript.segment_count + rows.length,
      message_count: transcript.message_count + parsed.messageCount,
      byte_count: transcript.byte_count + parsed.consumedBytes,
      token_estimate: transcript.token_estimate + totalTokens(parsed.segments),
      last_ingested_offset: nextOffset,
      source_format: format,
    })
    .eq("id", transcript.id);

  if (updateError) {
    throw new RepositoryError(
      `Failed to advance transcript cursor: ${updateError.message}`
    );
  }

  return {
    transcript_id: transcript.id,
    segments_added: rows.length,
    segment_count: transcript.segment_count + rows.length,
    next_offset: nextOffset,
    skipped: false,
  };
}

// ─── Retrieval ──────────────────────────────────────────────────────────────

export interface TranscriptHit {
  segment_id: string;
  session_id: string;
  ordinal: number;
  role: string;
  kind: string;
  content: string;
  tool_name: string | null;
  importance: number;
  occurred_at: string;
  /** Which index produced this hit — useful for explaining ranking. */
  match: "semantic" | "keyword" | "both";
  score: number;
}

/** Snippet length for search results. Enough to judge relevance. */
const SNIPPET_CHARS = 600;

function snippet(text: string): string {
  const clean = text.trim();
  return clean.length > SNIPPET_CHARS
    ? `${clean.slice(0, SNIPPET_CHARS)}…`
    : clean;
}

/**
 * Search the conversation.
 *
 * Runs both indexes and merges. Keyword catches exact identifiers — a function
 * name, an error code, a file path — which is what an agent most often searches
 * for and which embeddings are notoriously bad at. Vector catches the
 * paraphrase: "why did the retry approach fail" finds reasoning that never uses
 * the word "retry". Neither alone is sufficient.
 *
 * A segment found by both ranks above one found by either, since agreement
 * between two independent signals is the strongest evidence available here.
 */
export async function searchTranscripts(
  client: SupabaseClient,
  workspaceId: string,
  options: {
    projectId?: string | null;
    query: string;
    limit?: number;
    minImportance?: number;
  }
): Promise<TranscriptHit[]> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 12));
  const minImportance = options.minImportance ?? 0;
  const query = options.query?.trim();
  if (!query) return [];

  const byId = new Map<string, TranscriptHit>();

  // ── Keyword ───────────────────────────────────────────────────────────────
  // Strip tsquery operators so user input cannot break the parser.
  const ftsQuery = query.replace(/[():&|!<>*]/g, " ").trim();
  if (ftsQuery.length > 0) {
    let keywordQuery = client
      .from("transcript_segments")
      .select(
        "id, session_id, ordinal, role, kind, content, tool_name, importance, occurred_at"
      )
      .eq("workspace_id", workspaceId)
      .textSearch("fts", ftsQuery, { type: "plain", config: "english" })
      .gte("importance", minImportance)
      .order("importance", { ascending: false })
      .limit(limit * 2);

    if (options.projectId) {
      keywordQuery = keywordQuery.eq("project_id", options.projectId);
    }

    const { data, error } = await keywordQuery;
    if (error) {
      logger.warn({ err: error }, "Transcript keyword search failed");
    } else {
      for (const row of data ?? []) {
        const segment = row as Record<string, unknown>;
        byId.set(segment.id as string, {
          segment_id: segment.id as string,
          session_id: segment.session_id as string,
          ordinal: segment.ordinal as number,
          role: segment.role as string,
          kind: segment.kind as string,
          content: snippet(segment.content as string),
          tool_name: (segment.tool_name as string) ?? null,
          importance: segment.importance as number,
          occurred_at: segment.occurred_at as string,
          match: "keyword",
          // Keyword hits are scored by salience alone: Postgres ts_rank over
          // short segments is close to noise, and salience is the signal we
          // actually trust.
          score: 0.4 + (segment.importance as number) / 25,
        });
      }
    }
  }

  // ── Semantic ──────────────────────────────────────────────────────────────
  // Returns null with no EMBEDDING_API_KEY, which is a supported deployment:
  // keyword results above stand on their own.
  const embedding = await generateEmbedding(query);
  if (embedding) {
    const { data, error } = await client.rpc("match_transcript_segments", {
      query_embedding: `[${embedding.join(",")}]`,
      match_workspace_id: workspaceId,
      match_project_id: options.projectId ?? null,
      match_limit: limit * 2,
      min_importance: minImportance,
    });

    if (error) {
      logger.warn({ err: error }, "Transcript semantic search failed");
    } else {
      for (const row of data ?? []) {
        const segment = row as Record<string, unknown>;
        const id = segment.segment_id as string;
        const existing = byId.get(id);

        if (existing) {
          // Found by both indexes: strongest possible signal here.
          existing.match = "both";
          existing.score = Math.max(existing.score, segment.score as number) + 0.25;
          continue;
        }

        byId.set(id, {
          segment_id: id,
          session_id: segment.session_id as string,
          ordinal: segment.ordinal as number,
          role: segment.role as string,
          kind: segment.kind as string,
          content: snippet(segment.content as string),
          tool_name: (segment.tool_name as string) ?? null,
          importance: segment.importance as number,
          occurred_at: segment.occurred_at as string,
          match: "semantic",
          score: segment.score as number,
        });
      }
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Read the conversation around a segment.
 *
 * The other half of search. A matching paragraph on its own is rarely enough to
 * act on — you need the prompt that led to it and the result that followed. A
 * dense ordinal makes this one indexed range scan.
 */
export async function readTranscriptWindow(
  client: SupabaseClient,
  workspaceId: string,
  sessionId: string,
  options: { around?: number; radius?: number; from?: number; limit?: number } = {}
): Promise<{
  session_id: string;
  segments: Array<{
    ordinal: number;
    role: string;
    kind: string;
    content: string;
    tool_name: string | null;
    truncated: boolean;
    occurred_at: string;
  }>;
  total: number;
}> {
  const session = await getSessionById(client, sessionId);
  if (!session || session.workspace_id !== workspaceId) {
    throw new ValidationError(`Session ${sessionId} not found`);
  }

  const radius = Math.min(30, Math.max(1, options.radius ?? 6));
  const limit = Math.min(100, Math.max(1, options.limit ?? radius * 2 + 1));

  let query = client
    .from("transcript_segments")
    .select(
      "ordinal, role, kind, content, tool_name, truncated, occurred_at",
      { count: "exact" }
    )
    .eq("session_id", sessionId)
    .order("ordinal", { ascending: true })
    .limit(limit);

  if (options.around !== undefined) {
    query = query
      .gte("ordinal", Math.max(0, options.around - radius))
      .lte("ordinal", options.around + radius);
  } else if (options.from !== undefined) {
    query = query.gte("ordinal", Math.max(0, options.from));
  }

  const { data, error, count } = await query;
  if (error) {
    throw new RepositoryError(
      `Failed to read transcript window: ${error.message}`
    );
  }

  return {
    session_id: sessionId,
    segments: (data ?? []) as Array<{
      ordinal: number;
      role: string;
      kind: string;
      content: string;
      tool_name: string | null;
      truncated: boolean;
      occurred_at: string;
    }>,
    total: count ?? (data ?? []).length,
  };
}

// ─── Embedding backfill ─────────────────────────────────────────────────────

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Embed segments that do not have an embedding yet.
 *
 * Runs from the internal cron rather than inline at ingest, for the reason that
 * governs this whole subsystem: ingest sits on the hot path of a hook, and a
 * hook must never wait on a third-party API. Search works on keyword alone
 * until this catches up.
 *
 * Only salient kinds are embedded. Embedding every `ls` output would cost real
 * money to make search worse — the noise would crowd out reasoning in the
 * vector neighbourhood, which is exactly backwards.
 */
export async function embedPendingSegments(
  client: SupabaseClient,
  options: { limit?: number; minImportance?: number } = {}
): Promise<{ embedded: number; skipped: number }> {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const minImportance = options.minImportance ?? 2;

  // Segments with no embedding row yet. The NOT EXISTS is expressed as a left
  // join filter because PostgREST cannot express a correlated subquery.
  const { data, error } = await client
    .from("transcript_segments")
    .select(
      "id, workspace_id, project_id, content, transcript_segment_embeddings(segment_id)"
    )
    .gte("importance", minImportance)
    .is("transcript_segment_embeddings", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new RepositoryError(
      `Failed to list segments needing embeddings: ${error.message}`
    );
  }

  let embedded = 0;
  let skipped = 0;

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const content = row.content as string;
    const vector = await generateEmbedding(content);
    if (!vector) {
      // No API key, or the provider failed. Either way, stop the batch: every
      // subsequent call would fail the same way.
      skipped += 1;
      break;
    }

    const { error: insertError } = await client
      .from("transcript_segment_embeddings")
      .insert({
        segment_id: row.id as string,
        workspace_id: row.workspace_id as string,
        project_id: row.project_id as string,
        embedding: `[${vector.join(",")}]`,
        content_hash: contentHash(content),
      });

    if (insertError) {
      // A duplicate means a concurrent run got there first; anything else is
      // logged and skipped so one bad row cannot stall the backfill.
      if (insertError.code !== "23505") {
        logger.warn(
          { err: insertError, segmentId: row.id },
          "Failed to store transcript segment embedding"
        );
      }
      skipped += 1;
      continue;
    }
    embedded += 1;
  }

  return { embedded, skipped };
}

/** Transcript coverage for a project, used by the brief's "dig deeper" note. */
export async function getTranscriptCoverage(
  client: SupabaseClient,
  projectId: string
): Promise<{ sessions: number; segments: number; tokens: number }> {
  const { data, error } = await client
    .from("session_transcripts")
    .select("segment_count, token_estimate")
    .eq("project_id", projectId);

  if (error) {
    logger.warn({ err: error }, "Failed to read transcript coverage");
    return { sessions: 0, segments: 0, tokens: 0 };
  }

  const rows = (data ?? []) as Array<{
    segment_count: number;
    token_estimate: number;
  }>;

  return {
    sessions: rows.length,
    segments: rows.reduce((sum, r) => sum + (r.segment_count ?? 0), 0),
    tokens: rows.reduce((sum, r) => sum + (r.token_estimate ?? 0), 0),
  };
}
