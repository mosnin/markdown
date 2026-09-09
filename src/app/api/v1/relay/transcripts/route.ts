import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRelayAuth } from "@/server/auth/relay_auth";
import { withApiHandler } from "@/server/api/with_api_handler";
import {
  apiOk,
  E_BAD_REQUEST,
  E_INSUFFICIENT_SCOPE,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  ingestTranscriptChunk,
  MAX_TRANSCRIPT_CHUNK_BYTES,
} from "@/server/services/transcript_service";
import { openOrResumeSession } from "@/server/services/session_ingest_service";
import { type OpenSessionRequest } from "@/server/services/session_ingest_service";
import { type TranscriptFormat } from "@/server/services/transcript_parser";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/relay/transcripts
 *
 * Ship a chunk of an agent's conversation. This is the layer that lets a later
 * agent read what an earlier one actually said, rather than only what it
 * concluded.
 *
 * Body:
 *   {
 *     session_id | session,   // as with /events, either identifies the session
 *     content,                // raw transcript bytes for this chunk
 *     format,                 // "claude_code_jsonl" | "codex_jsonl" | "plain"
 *     from_offset             // byte offset in the source file this chunk starts at
 *   }
 *
 * Incremental by design. The response's `next_offset` is where the client
 * should resume; sending the same chunk twice is a no-op, and a client that
 * has fallen behind is told where our cursor actually is instead of
 * duplicating segments.
 *
 * Auth: relay key, or OAuth token with `relay:write`.
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const ctx = await resolveRelayAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!ctx.canWrite) return E_INSUFFICIENT_SCOPE("relay:write");

  let body: {
    session_id?: string;
    session?: OpenSessionRequest;
    content?: string;
    format?: TranscriptFormat;
    from_offset?: number;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  if (typeof body.content !== "string" || body.content.length === 0) {
    return E_BAD_REQUEST("content is required");
  }
  if (Buffer.byteLength(body.content, "utf8") > MAX_TRANSCRIPT_CHUNK_BYTES) {
    return E_BAD_REQUEST(
      `content exceeds ${MAX_TRANSCRIPT_CHUNK_BYTES} bytes; send it in smaller chunks`
    );
  }

  const admin = createAdminClient();

  let sessionId = body.session_id;
  if (!sessionId) {
    if (!body.session) {
      return E_BAD_REQUEST("Either session_id or session must be provided");
    }
    const { session } = await openOrResumeSession(
      admin,
      ctx.workspaceId,
      body.session
    );
    sessionId = session.id;
  }

  const result = await ingestTranscriptChunk(admin, ctx.workspaceId, sessionId, {
    content: body.content,
    format: body.format,
    from_offset: body.from_offset,
  });

  return apiOk({ session_id: sessionId, ...result }, 202);
});
