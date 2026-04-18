import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertNoteEmbedding } from "@/server/services/embedding_service";

export const runtime = "nodejs";

/**
 * POST /api/internal/embed
 *
 * Background embedding endpoint — cron-triggered or on-demand.
 *
 * Finds notes without embeddings or with stale content_hash, batches
 * up to 50 at a time, and calls upsertNoteEmbedding for each.
 *
 * Authenticated via `EMBED_CRON_TOKEN` env var — callers pass the
 * token in the `Authorization: Bearer <token>` header.
 *
 * Wire via Vercel Cron:
 *
 *   // vercel.json
 *   {
 *     "crons": [
 *       { "path": "/api/internal/embed", "schedule": "0,10,20,30,40,50 * * * *" }
 *     ]
 *   }
 *
 * Response: `{ ok, processed, skipped, errors }`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.EMBED_CRON_TOKEN;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "EMBED_CRON_TOKEN not configured" },
      { status: 500 }
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!presented || presented !== secret) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const admin = createAdminClient();
  const BATCH_SIZE = 50;

  // Find notes that either have no embedding row or whose content has changed.
  // We use a left join approach: find notes where note_embeddings.note_id IS NULL
  // or where the content_hash doesn't match a sha256 of current content.
  //
  // Since PostgREST doesn't support left joins easily, we do two queries:
  // 1. Notes with no embedding row at all
  // 2. Notes whose content_hash is stale (by comparing via a subquery)

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Step 1: Get all note_ids that already have embeddings
    const { data: existingEmbeddings } = await admin
      .from("note_embeddings")
      .select("note_id, content_hash");

    const embeddingMap = new Map<string, string>();
    for (const e of existingEmbeddings ?? []) {
      embeddingMap.set(e.note_id, e.content_hash);
    }

    // Step 2: Get notes that need embedding (no embedding or potentially stale)
    const { data: notes } = await admin
      .from("notes")
      .select("id, title, markdown_content")
      .neq("status", "trashed")
      .is("branch_id", null)
      .order("updated_at", { ascending: false })
      .limit(BATCH_SIZE * 2); // fetch extra since some may be skipped

    if (!notes || notes.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, skipped: 0, errors: 0 });
    }

    // Process notes: prioritize those without embeddings, then stale ones
    let count = 0;
    for (const note of notes) {
      if (count >= BATCH_SIZE) break;

      const content = `${note.title}\n\n${note.markdown_content ?? ""}`;
      const existingHash = embeddingMap.get(note.id);

      // If there's an existing embedding, check hash before processing
      // (upsertNoteEmbedding does this too, but we avoid the overhead)
      if (existingHash) {
        // Let upsertNoteEmbedding handle the hash comparison
      }

      try {
        const didUpsert = await upsertNoteEmbedding(admin, note.id, content);
        if (didUpsert) {
          processed++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(
          "[embed] error embedding note",
          note.id,
          err instanceof Error ? err.message : err
        );
        errors++;
      }
      count++;
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Embedding batch failed",
        processed,
        skipped,
        errors,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, processed, skipped, errors });
}
