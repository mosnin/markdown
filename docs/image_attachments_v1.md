# Image attachments (v1)

Lets users add images to a note, either by **pasting** from the clipboard or by clicking the **Attach image** toolbar button. Uploads land in a public Supabase Storage bucket, are described by GPT-4o vision, and inserted into the CRDT editor as `![description](url)` markdown.

## 1. Overview

Two client entry points converge on the same pair of server actions:

```
┌──────────────────────────────────────────────────────────────┐
│                         BROWSER                               │
│                                                               │
│  Paste event (clipboard)  ──►  useImagePaste                  │
│  File picker button       ──►  ImageAttachment                │
│                                    │                          │
│                                    │  uploadNoteImageAction   │
│                                    ▼                          │
│                         Supabase Storage                      │
│                       (bucket: note-images)                   │
│                                    │                          │
│                                    │  describeImageAction     │
│                                    ▼                          │
│                       OpenAI Chat Completions                 │
│                            (model: gpt-4o)                    │
│                                    │                          │
│                                    │ { url, description }     │
│                                    ▼                          │
│              NoteCrdtEditor.insertImageMarkdown               │
│            inserts `![description](url)\n` at caret           │
└──────────────────────────────────────────────────────────────┘
```

## 2. Server actions

Source: `src/app/app/notes/image_actions.ts`. Both actions are `"use server"` and require an authenticated workspace user via `requireAuthenticatedUser()`.

### `uploadNoteImageAction(noteId, formData)`

Uploads a single image to the `note-images` Supabase Storage bucket under a per-workspace/per-note path.

Input:
- `noteId: string` — UUID of the target note.
- `formData: FormData` — must contain an `image` field whose value is a `File`.

Result:
```ts
type UploadNoteImageResult =
  | { ok: true; url: string; path: string }
  | { ok: false; error: string };
```

Flow:
1. Resolve `ctx = await requireAuthenticatedUser()`.
2. Load the note via `getNoteById`, then its box via `getBoxById`. Reject with `"Not authorised"` if the box's `workspace_id` does not match `ctx.workspace.id`.
3. Pull `formData.get("image")`; non-File → `"No image file provided"`.
4. Validate `file.type` against `MIME_TO_EXT` (see §3). Unknown → `"Unsupported image type. Use JPEG, PNG, WebP, or GIF."`
5. Validate `file.size <= MAX_FILE_SIZE` (10 MB). Over → `"Image must be 10MB or smaller"`.
6. Compute `path = "${workspace_id}/${note_id}/${randomUUID()}.${ext}"`.
7. Upload via `createAdminClient().storage.from("note-images").upload(path, buffer, { contentType, upsert: false })`.
8. On `Bucket not found` / `not found` style messages, return the friendly `'Storage bucket "note-images" does not exist. Please create it in the Supabase dashboard under Storage.'` error — prompts the operator to run `scripts/create_storage_bucket.ts` (documented separately).
9. Return `{ ok: true, url: <publicUrl>, path }` from `getPublicUrl(path)`.

### `describeImageAction(imageUrl, noteId)`

Calls GPT-4o vision to produce a one/two-sentence alt-text description for the uploaded image.

Input:
- `imageUrl: string` — typically the `url` returned by `uploadNoteImageAction`.
- `noteId: string` — used for the same workspace-ownership check as the uploader.

Result:
```ts
type DescribeImageResult =
  | { ok: true; description: string }
  | { ok: false; error: string };
```

Flow:
1. `requireAuthenticatedUser()`.
2. **Rate limit:** `checkRateLimit(\`image:describe:${ctx.user.id}\`, 10, 60)` — 10 vision calls per minute per user. On exceed returns `"Too many image descriptions. Try again in ${rl.retryAfter}s."`.
3. Re-run the note → box → workspace ownership check.
4. Read `process.env.EMBEDDING_API_KEY`. Unset → `"OpenAI API key is not configured"`.
5. Base URL = `process.env.EMBEDDING_API_BASE_URL ?? "https://api.openai.com/v1"` — so a self-hosted OpenAI-compatible gateway can serve both embeddings and vision.
6. POST `${baseUrl}/chat/completions` with body:
   ```json
   {
     "model": "gpt-4o",
     "messages": [{
       "role": "user",
       "content": [
         { "type": "text", "text": "Describe this image briefly in one or two sentences. Focus on the main subject and key details." },
         { "type": "image_url", "image_url": { "url": imageUrl } }
       ]
     }],
     "max_tokens": 300
   }
   ```
7. Description is `json.choices?.[0]?.message?.content ?? ""`, then `slice(0, 500)` (hard cap on alt-text length).

Errors surface as `"Vision API error <status>: <body-first-200-chars>"` or the thrown message.

## 3. MIME whitelist

```ts
// image_actions.ts
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg":  "jpg",
  "image/png":  "png",
  "image/webp": "webp",
  "image/gif":  "gif",
};
```

SVG is **deliberately excluded**. The in-source comment explains why: "SVGs can contain `<script>` tags and would execute as XSS if served from a public bucket." Since `note-images` is publicly readable, allowing SVG uploads would turn every workspace into a drive-by XSS vector.

## 4. Size limits

```ts
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
```

Applied once in `uploadNoteImageAction`. Pastes and file-picker selections both flow through the same action.

## 5. Storage path format

```
${workspace_id}/${note_id}/${uuid}.${ext}
```

Where:
- `workspace_id` — resolved from the authenticated context (`ctx.workspace.id`).
- `note_id` — parameter passed into the action.
- `uuid` — generated with `crypto.randomUUID()` on each upload.
- `ext` — resolved from `MIME_TO_EXT`.

Paths prefixed by `workspace_id` make workspace-level cleanup and storage accounting straightforward.

## 6. Rate limit

`describeImageAction` is rate-limited because GPT-4o vision is disproportionately expensive compared to a storage upload:

```ts
const rl = await checkRateLimit(`image:describe:${ctx.user.id}`, 10, 60);
```

Implementation lives in `src/lib/api/rate_limit.ts` (Upstash Redis sliding-window in production; in-memory Map fallback). The limit is **10 calls / 60 seconds / user**.

`uploadNoteImageAction` is *not* rate-limited at the action layer — the 10 MB cap and Supabase Storage's own throttling are the primary defence there.

## 7. Paste hook — `useImagePaste(noteId, onImageInserted)`

Source: `src/hooks/use_image_paste.ts`.

Signature:
```ts
export function useImagePaste(
  noteId: string,
  onImageInserted: (url: string, description: string) => void
): { isUploading: boolean; error: string | null }
```

Behaviour:
- Attaches a single `document.addEventListener("paste", handlePaste)` in a `useEffect` with `[noteId]` as the dependency list.
- The `onImageInserted` callback is stored in a ref (`onImageInsertedRef`) refreshed on every render, so the paste listener is **not** re-registered when the parent re-creates the callback each render. The comment captures the intent: *"Stabilize the callback so the paste listener isn't re-registered every time the parent re-renders with a fresh inline callback."*
- On paste, iterates `event.clipboardData.items`, finds the first item whose `type.startsWith("image/")`, calls `event.preventDefault()` so the raw blob doesn't land as garbled text in the editor, and runs upload → describe → insert.
- `isUploading` is `true` while the pair of actions is in flight. `error` captures the first failure's message; success paths leave it at `null`.
- A local `cancelled` flag prevents state writes and listener callbacks after unmount.

## 8. File-picker component — `ImageAttachment`

Source: `src/components/product/image_attachment.tsx`.

Props:
```ts
interface ImageAttachmentProps {
  noteId: string;
  onInserted: (url: string, description: string) => void;
}
```

Renders a hidden `<input type="file" accept="image/*">` and a visible button that opens the picker. On change:
1. Reads the first selected file.
2. Calls `uploadNoteImageAction` then `describeImageAction` (same pair as the paste path).
3. Calls `onInserted(url, description)` on success.
4. Resets the input's `value` to `""` so the same file can be picked twice in a row.

Idle state shows the `ImageIcon` and the label "Attach image"; while uploading it swaps to `Loader2` with `animate-spin` and disables the button.

## 9. Editor integration

Source: `src/components/product/note_crdt_editor.tsx` (lines 164–186).

`NoteCrdtEditor` wires both entry points to the same `insertImageMarkdown` callback:

```tsx
const insertImageMarkdown = useCallback(
  (url: string, description: string) => {
    const view = cmRef.current?.view;
    const text = `![${description}](${url})\n`;
    if (view) {
      const pos = view.state.selection.main.head;
      view.dispatch({
        changes: { from: pos, to: pos, insert: text },
        selection: { anchor: pos + text.length },
      });
    } else {
      yText.insert(yText.length, text);
    }
  },
  [yText]
);

const { isUploading: isPasteUploading, error: pasteError } = useImagePaste(
  noteId,
  insertImageMarkdown
);

// ...and the toolbar:
<ImageAttachment noteId={noteId} onInserted={insertImageMarkdown} />
```

Notes:
- Inserts a trailing `\n` so the next keystroke starts on a fresh line.
- Falls back to `yText.insert(yText.length, ...)` when the CodeMirror view isn't mounted; Yjs handles the CRDT merge regardless of which path runs.
- `isPasteUploading` / `pasteError` are surfaced as tiny toolbar indicators ("Uploading…" / red truncated error).

## 10. Bucket setup

The `note-images` bucket **must exist** before the first upload. `uploadNoteImageAction` specifically detects the "bucket not found" family of errors and responds with a friendly pointer to the Supabase dashboard:

> Storage bucket "note-images" does not exist. Please create it in the Supabase dashboard under Storage.

A helper script exists to create the bucket idempotently: `scripts/create_storage_bucket.ts` (hard-codes `BUCKET_NAME = "note-images"`). That script's docs are owned by Team D — see their scripts reference.

## 11. Environment variables

| Var | Required | Used by | Notes |
| --- | --- | --- | --- |
| `EMBEDDING_API_KEY` | Yes (for description) | `describeImageAction` | Passed as `Authorization: Bearer ...` to the vision endpoint. Unset → `"OpenAI API key is not configured"`. |
| `EMBEDDING_API_BASE_URL` | Optional | `describeImageAction` | Defaults to `"https://api.openai.com/v1"`. Override to point at a self-hosted OpenAI-compatible gateway. |
| Supabase service-role key (via `createAdminClient`) | Yes (for upload) | `uploadNoteImageAction` | Used to bypass RLS when writing into the `note-images` bucket. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`) | Optional | `checkRateLimit` | When unset, falls back to the in-memory rate limiter. |

## 12. Security

- **SVG exclusion.** MIME whitelist blocks `image/svg+xml`. Stops `<script>`-in-SVG XSS against anyone viewing an image URL from the public bucket.
- **10 MB size cap.** Enforced before the buffer is allocated; blocks DoS-by-upload.
- **Workspace ownership check.** Both actions walk `note → box → workspace_memberships` (via `ctx.workspace.id` in this case, since `requireAuthenticatedUser` already resolves the active workspace). A cross-workspace `noteId` returns `"Not authorised"`.
- **Public read, authorised write.** The bucket is configured publicly readable so `![](url)` just works in every viewer, while writes go through the admin client behind the server action — end-users never touch storage directly.
- **Vision rate limit.** GPT-4o vision is an expensive call; the 10/min/user limit prevents a runaway paste loop from racking up a bill.
- **Description length cap.** `description.slice(0, 500)` prevents a prompt-injection response from flooding the editor with a 10 KB blob.
