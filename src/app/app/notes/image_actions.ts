"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { getNoteById } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { randomUUID } from "crypto";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const BUCKET = "note-images";

function getExtension(mimeType: string): string {
  const parts = mimeType.split("/");
  return parts[1] ?? "bin";
}

export type UploadNoteImageResult =
  | { ok: true; url: string; path: string }
  | { ok: false; error: string };

export async function uploadNoteImageAction(
  noteId: string,
  formData: FormData
): Promise<UploadNoteImageResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    // Authorize: note must belong to a box in the user's workspace.
    const note = await getNoteById(supabase, noteId);
    if (!note) return { ok: false, error: "Note not found" };
    const box = await getBoxById(supabase, note.box_id);
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not authorised" };
    }

    const file = formData.get("image");
    if (!(file instanceof File)) {
      return { ok: false, error: "No image file provided" };
    }

    // Validate MIME type.
    if (!file.type.startsWith("image/")) {
      return { ok: false, error: "File must be an image" };
    }

    // Validate size.
    if (file.size > MAX_FILE_SIZE) {
      return { ok: false, error: "Image must be 10MB or smaller" };
    }

    const ext = getExtension(file.type);
    const uuid = randomUUID();
    const path = `${ctx.workspace.id}/${noteId}/${uuid}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      // Provide a helpful message if the bucket doesn't exist.
      const msg = uploadError.message ?? String(uploadError);
      if (
        msg.includes("Bucket not found") ||
        msg.includes("bucket") ||
        msg.includes("not found")
      ) {
        return {
          ok: false,
          error:
            'Storage bucket "note-images" does not exist. Please create it in the Supabase dashboard under Storage.',
        };
      }
      return { ok: false, error: `Upload failed: ${msg}` };
    }

    const {
      data: { publicUrl },
    } = admin.storage.from(BUCKET).getPublicUrl(path);

    return { ok: true, url: publicUrl, path };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to upload image",
    };
  }
}

export type DescribeImageResult =
  | { ok: true; description: string }
  | { ok: false; error: string };

export async function describeImageAction(
  imageUrl: string,
  noteId: string
): Promise<DescribeImageResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    // Authorize.
    const note = await getNoteById(supabase, noteId);
    if (!note) return { ok: false, error: "Note not found" };
    const box = await getBoxById(supabase, note.box_id);
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not authorised" };
    }

    const apiKey = process.env.EMBEDDING_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "OpenAI API key is not configured" };
    }

    const baseUrl =
      process.env.EMBEDDING_API_BASE_URL ?? "https://api.openai.com/v1";

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this image briefly in one or two sentences. Focus on the main subject and key details.",
              },
              {
                type: "image_url",
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        max_tokens: 300,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      return {
        ok: false,
        error: `Vision API error ${resp.status}: ${errText.slice(0, 200)}`,
      };
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawDescription = json.choices?.[0]?.message?.content ?? "";
    const description = rawDescription.slice(0, 500);

    return { ok: true, description };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to describe image",
    };
  }
}
