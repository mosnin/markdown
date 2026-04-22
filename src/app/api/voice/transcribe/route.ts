/**
 * POST /api/voice/transcribe
 *
 * Accepts a multipart/form-data request with:
 *   - audio: Blob — the recorded audio file
 *   - note_id: string — the note the transcription is destined for
 *
 * Authenticates the user via Supabase session cookie, verifies the note
 * belongs to the user's workspace, then calls the OpenAI Whisper API
 * and returns the transcription text.
 *
 * Rate-limited to 10 transcriptions per minute per user.
 */

import { type NextRequest } from "next/server";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { getNoteById } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { checkRateLimit } from "@/lib/api/rate_limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // ── 1. Authenticate via Supabase session cookie ───────────────────────────
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Rate limit: 10 transcriptions per minute per user ─────────────────
  const rl = await checkRateLimit(`voice:transcribe:${user.id}`, 10, 60);
  if (!rl.allowed) {
    return Response.json(
      { ok: false, error: "Too many requests. Please wait before transcribing again." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      }
    );
  }

  // ── 3. Parse multipart form data ─────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid multipart form data" },
      { status: 400 }
    );
  }

  const audioField = formData.get("audio");
  const noteId = formData.get("note_id");

  if (!audioField || !(audioField instanceof File)) {
    return Response.json(
      { ok: false, error: "Missing or invalid 'audio' field" },
      { status: 400 }
    );
  }

  if (!noteId || typeof noteId !== "string") {
    return Response.json(
      { ok: false, error: "Missing or invalid 'note_id' field" },
      { status: 400 }
    );
  }

  // ── 4. Verify the note belongs to the authenticated user's workspace ──────
  const note = await getNoteById(supabase, noteId);
  if (!note) {
    return Response.json({ ok: false, error: "Note not found" }, { status: 404 });
  }

  const box = await getBoxById(supabase, note.box_id);
  if (!box) {
    return Response.json({ ok: false, error: "Box not found" }, { status: 404 });
  }

  // Verify the user is a member of the note's workspace
  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("workspace_id", box.workspace_id)
    .eq("user_id", user.id)
    .limit(1);

  if (!membership || membership.length === 0) {
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // ── 5. Call OpenAI Whisper API ────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[voice/transcribe] OPENAI_API_KEY is not set");
    return Response.json(
      { ok: false, error: "Transcription service is not configured" },
      { status: 503 }
    );
  }

  const whisperForm = new FormData();
  whisperForm.append("file", audioField, audioField.name || "audio.webm");
  whisperForm.append("model", "whisper-1");
  whisperForm.append("response_format", "json");

  let transcriptionText: string;
  try {
    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: whisperForm,
    });

    if (!resp.ok) {
      const errorBody = await resp.text().catch(() => "");
      console.error(
        `[voice/transcribe] Whisper API error ${resp.status}: ${errorBody}`
      );
      return Response.json(
        { ok: false, error: "Transcription failed. Please try again." },
        { status: 502 }
      );
    }

    const json = (await resp.json()) as { text?: string };
    if (typeof json.text !== "string") {
      console.error("[voice/transcribe] Unexpected Whisper response shape:", json);
      return Response.json(
        { ok: false, error: "Unexpected response from transcription service" },
        { status: 502 }
      );
    }

    transcriptionText = json.text;
  } catch (err) {
    console.error(
      "[voice/transcribe] fetch error:",
      err instanceof Error ? err.message : err
    );
    return Response.json(
      { ok: false, error: "Failed to reach transcription service" },
      { status: 502 }
    );
  }

  return Response.json({ ok: true, text: transcriptionText });
}
