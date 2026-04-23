# Voice transcription (v1)

Browser-based audio capture wired into the CRDT note editor. Users click
a microphone button in the note toolbar, record speech, and receive a
transcription inserted at the cursor position. Transcription is backed
by OpenAI Whisper.

## 1. Overview

End-to-end flow:

1. The user clicks `VoiceRecorderButton` in the note toolbar.
2. The browser captures microphone audio via `MediaRecorder`
   (`useVoiceRecorder`).
3. On stop, the client POSTs the audio blob + `note_id` to
   `POST /api/voice/transcribe` as `multipart/form-data`.
4. The server authenticates the session, rate-limits the caller,
   verifies workspace membership for the target note, and forwards the
   audio to the OpenAI Whisper `audio/transcriptions` endpoint
   (`whisper-1` model).
5. The server returns `{ ok: true, text }`; the editor inserts the
   transcription at the current cursor position via `handleTranscription`
   in `note_crdt_editor.tsx` (trailing-space normalized so subsequent
   typing doesn't collide with the last word).

## 2. Route spec — `POST /api/voice/transcribe`

Source: `src/app/api/voice/transcribe/route.ts`.

- **Runtime:** `nodejs` (declared via `export const runtime = "nodejs"`).
- **Auth:** Supabase session cookie via
  `createClient` from `@/lib/supabase/server`. Missing user → `401
  Unauthorized`.
- **Rate limit:** `checkRateLimit("voice:transcribe:${user.id}", 10, 60)`
  — 10 transcriptions per user per 60-second sliding window. Exceeded
  requests return `429` with a `Retry-After` header (seconds until the
  window resets).
- **Request body:** `multipart/form-data` with:
  - `audio`: `File` — the recorded audio blob. Missing or non-File →
    `400`.
  - `note_id`: `string` — UUID of the destination note. Missing or
    non-string → `400`.
- **Size cap:** `MAX_AUDIO_BYTES = 25 * 1024 * 1024` (25 MiB, matches
  the Whisper API limit). Requests above the cap → `413`.
- **Workspace check:** loads the note via `getNoteById`, then the
  containing box via `getBoxById`, then verifies a
  `workspace_memberships` row with matching `workspace_id` and the
  authenticated `user_id`. Missing note → `404 Note not found`;
  missing box → `404 Box not found`; missing membership → `403
  Forbidden`.
- **Whisper call:** POSTs to
  `https://api.openai.com/v1/audio/transcriptions` with `model=whisper-1`,
  `response_format=json`, `Authorization: Bearer ${OPENAI_API_KEY}`.
  Upstream non-2xx → `502 Transcription failed. Please try again.`;
  unexpected response shape → `502 Unexpected response from transcription
  service`; fetch error → `502 Failed to reach transcription service`.
- **Success response:** `{ ok: true, text: string }` (HTTP 200).
- **Error response:** `{ ok: false, error: string }` with the status
  codes described above.

## 3. Client hook — `useVoiceRecorder(noteId)`

Source: `src/hooks/use_voice_recorder.ts`.

Feature-detects `window`, `MediaRecorder`, and `navigator.mediaDevices`.
When any is missing returns `{ supported: false }`. Otherwise returns:

```ts
interface VoiceRecorderSupported {
  supported: true;
  isRecording: boolean;
  isTranscribing: boolean;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
}
```

Implementation notes:

- Preferred MIME type is picked from a candidate list via
  `MediaRecorder.isTypeSupported`, in order:
  `audio/webm;codecs=opus`, `audio/webm`, `audio/ogg;codecs=opus`,
  `audio/ogg`, `audio/mp4`. Falls back to the `MediaRecorder` default
  when none match.
- `MediaRecorder` is started with a 100 ms timeslice
  (`recorder.start(100)`).
- `startRecording` requests `getUserMedia({ audio: true })`; if the
  browser throws `NotAllowedError` the hook sets a "Microphone access
  denied" error; other failures set "Could not access microphone".
- `stopRecording` resolves a `Blob` from the collected chunks, stops
  every track on the captured `MediaStream` (releases the browser's
  microphone indicator), then POSTs to `/api/voice/transcribe` with
  the audio and `note_id`. The uploaded filename is `recording.ogg` if
  the MIME type contains `"ogg"`, otherwise `recording.webm`.
- On failure it sets `error` and resolves `null`; on success it
  resolves the transcription `text`.

## 4. UI component — `VoiceRecorderButton`

Source: `src/components/product/voice_recorder_button.tsx`.

Props:

```ts
interface VoiceRecorderButtonProps {
  noteId: string;
  onTranscription: (text: string) => void;
}
```

Behaviour:

- Renders nothing (`return null`) when `useVoiceRecorder` reports
  `supported: false` — browsers without `MediaRecorder` simply don't
  see the button.
- Icon states (lucide-react):
  - **Idle** — `Mic` icon, muted-foreground colour.
  - **Recording** — `MicOff` icon, destructive colour, `animate-pulse`
    class. Clicking again calls `stopRecording`.
  - **Transcribing** — `Loader2` spinning; the button is disabled
    (`cursor-not-allowed`, `opacity-60`).
- `aria-pressed={isRecording}` and dynamic `aria-label` / `title`
  reflect the current state.
- When `stopRecording` resolves a non-null string, the component calls
  `onTranscription(text)`; errors are surfaced inline beneath the
  button in a small red caption.

## 5. Editor integration

Source: `src/components/product/note_crdt_editor.tsx`.

`NoteCrdtEditor` mounts a `VoiceRecorderButton` in its toolbar and
passes `handleTranscription` as `onTranscription`:

```tsx
<VoiceRecorderButton noteId={noteId} onTranscription={handleTranscription} />
```

`handleTranscription(text)`:

1. Normalises the text so it ends in a space or newline
   (`text.endsWith(" ") || text.endsWith("\n") ? text : `${text} `).
2. If the CodeMirror view ref is live, dispatches a transaction that
   inserts the normalised text at the current `selection.main.head`
   position and moves the cursor to the end of the insertion.
3. If the view ref is not yet available, falls back to inserting at
   the end of the underlying `Y.Text` directly.

## 6. Environment variables

| Var | Required | Used by | Notes |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Yes | `POST /api/voice/transcribe` | Passed as the `Authorization: Bearer ...` header on the Whisper call. If unset, the route returns `503 Transcription service is not configured` and logs `"[voice/transcribe] OPENAI_API_KEY is not set"`. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_URL` / `KV_REST_API_TOKEN` pair) | Optional | `checkRateLimit` | Switches the rate limiter from the in-process Map to Upstash Redis for multi-instance correctness (see `src/lib/api/rate_limit.ts`). |

## 7. Errors and edge cases

| Condition | HTTP / behaviour |
| --- | --- |
| No Supabase session | `401 Unauthorized` |
| Rate limit exceeded | `429` with `Retry-After: <seconds>` header |
| Malformed `multipart/form-data` | `400 Invalid multipart form data` |
| Missing / non-File `audio` | `400 Missing or invalid 'audio' field` |
| Audio over 25 MiB | `413 Audio file exceeds maximum size (25MB)` |
| Missing / non-string `note_id` | `400 Missing or invalid 'note_id' field` |
| Note not in DB | `404 Note not found` |
| Note's box not in DB | `404 Box not found` |
| User not a member of the note's workspace | `403 Forbidden` |
| `OPENAI_API_KEY` not set | `503 Transcription service is not configured` |
| Whisper returns non-2xx | `502 Transcription failed. Please try again.` |
| Whisper response missing `text` | `502 Unexpected response from transcription service` |
| Fetch fails (DNS, timeout, etc.) | `502 Failed to reach transcription service` |
| `getUserMedia` denied (`NotAllowedError`) | Client-side — hook sets "Microphone access denied. Please allow microphone access and try again." |
| `getUserMedia` fails for any other reason | Client-side — hook sets "Could not access microphone. Please check your device settings." |

## 8. Security notes

- **Per-user rate limiting.** Keyed on `user.id`, not IP, so a noisy
  user can't starve others and an IP behind a shared NAT isn't
  penalised for someone else's misbehaviour.
- **Workspace membership check.** The route confirms the note exists,
  that it lives inside a box, and that the authenticated user is a
  member of that box's workspace — before the audio is ever forwarded
  to Whisper.
- **Hard size cap (`MAX_AUDIO_BYTES`).** Defends against DoS-by-upload
  and keeps us inside Whisper's 25 MiB hard limit so we never pay to
  send oversized blobs upstream.
- **Error log hygiene.** The route logs Whisper's HTTP status and
  response text (`errorBody`) but never the raw audio; user-facing
  errors are generic strings that don't leak upstream detail.
- **Microphone track cleanup.** `stopRecording` explicitly calls
  `track.stop()` on every track in the captured `MediaStream` so the
  browser's tab-level microphone indicator turns off as soon as the
  recording ends.
