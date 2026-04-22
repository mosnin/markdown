# Real-time Collaboration — v1 (Yjs CRDT)

Character-level conflict-free collaborative editing for notes. Replaces the "someone saved while you were editing" warning with true CRDT merging — two users can type in the same paragraph simultaneously with no data loss.

## Why Yjs over OT

| Concern | OT (@codemirror/collab) | Yjs CRDT |
|---------|------------------------|----------|
| Transport | Requires central server to sequence ops | Peer-to-peer; any broadcast works |
| Convergence | Guaranteed only with correct server | Guaranteed locally; no server state needed |
| Offline | Ops pile up; server arbitrates on reconnect | Merge happens client-side on reconnect |
| Complexity | O(n) server history | O(1) per update; tombstones are GC'd |

Yjs wins on transport flexibility — we can use Supabase Realtime Broadcast as the transport layer with no additional server infrastructure.

## Subsystem map

```
┌──────────────────────────────────────────────────────────────┐
│                      NOTE EDITOR (browser)                    │
│                                                               │
│  NoteEditor                                                   │
│   ├── CodeMirror (replaces textarea)                          │
│   │    └── yCollab(yText, awareness)                          │
│   │         ├── local edits → Y.Text CRDT ops                 │
│   │         └── remote ops → CodeMirror transaction           │
│   ├── useNoteYjsDoc(noteId, initialContent)                   │
│   │    ├── Y.Doc + Y.Text('content')                          │
│   │    └── SupabaseYjsProvider                                │
│   │         ├── broadcast outgoing Yjs updates                │
│   │         └── apply incoming updates from channel           │
│   └── autosave: yText.toString() → saveNoteAction             │
└──────────────────────────────────────────────────────────────┘
                          │ Supabase Realtime
                          │ note_crdt:{noteId}
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                  OTHER BROWSER TABS / USERS                   │
│   Same structure — Y.Doc merges via CRDT                      │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼ Autosave (every 1.5s after change)
┌──────────────────────────────────────────────────────────────┐
│                     POSTGRES (source of truth)                │
│   notes.markdown_content — last autosaved Yjs doc state      │
│   note_versions — immutable history as before                 │
└──────────────────────────────────────────────────────────────┘
```

## Transport — Supabase Realtime Broadcast

Channel name: `note_crdt:${noteId}`

Every Yjs update (a `Uint8Array`) is encoded as base64 and broadcast on this channel. Recipients apply it to their local Y.Doc.

```
{
  type: 'broadcast',
  event: 'yjs-update',
  payload: { update: '<base64 string>' }
}
```

On join, a new client cannot receive past history (Supabase Broadcast is ephemeral — it does not replay). Initial document state comes from `note.markdown_content` in the DB. Any edits made between the last autosave and a new client's join are received via Broadcast if other users are still present.

This is intentional: the DB autosave every 1.5s ensures the CRDT state visible in Broadcast diverges from the DB by at most ~1.5s of edits.

## Awareness — cursor positions

Supabase Realtime Presence (existing `note_presence:${noteId}` channel) is extended with a `cursor` field: `{ anchor: number, head: number }` (character offsets in the Yjs doc). CodeMirror renders remote cursors as inline decorations with per-user color coding.

The `useNotePresence` hook is extended to carry cursor position. NotePresenceCursors component renders colored cursor widgets in the CodeMirror view.

## Note editor migration: textarea → CodeMirror

The note body (markdown content) migrates from a plain `<textarea>` to CodeMirror 6 powered by `@uiw/react-codemirror`. The title stays as `<input>` — title edits are rare and autosave handles title conflicts.

**Document mode** — CodeMirror with:
- `markdown({ base: markdownLanguage, codeLanguages: ... })` extension
- `EditorView.lineWrapping`
- Proportional font via a theme extension (mirrors the textarea's `text-base leading-8`)

**Markdown mode** — same editor with a monospace theme variant + syntax highlighting visible.

Both modes are the same CodeMirror instance. Mode toggle just switches the theme/font class. This is simpler than two separate editors.

## Components

### `src/lib/crdt/supabase_yjs_provider.ts`
```ts
export class SupabaseYjsProvider {
  constructor(supabase: SupabaseClient, channelName: string, doc: Y.Doc)
  connect(): void        // subscribe to channel, observe doc for outgoing updates
  disconnect(): void     // unsubscribe, stop observing
  readonly synced: boolean
}
```

- `doc.on('update', (update, origin) => ...)`: when `origin !== this`, encode + broadcast
- Channel broadcast handler: decode + `Y.applyUpdate(doc, update, this)`
- Guards against self-echo (Supabase Broadcast echoes to sender by default; filter by `origin`)

### `src/lib/crdt/use_note_yjs_doc.ts`
```ts
export function useNoteYjsDoc(
  noteId: string,
  initialContent: string
): { yDoc: Y.Doc; yText: Y.Text; provider: SupabaseYjsProvider }
```

- Creates `Y.Doc` on mount, inserts `initialContent` into `yDoc.getText('content')` if the doc is empty
- Creates `SupabaseYjsProvider` and calls `connect()`
- Destroys doc and disconnects provider on unmount
- `noteId` change → new doc (clean per-note isolation)

### `src/lib/crdt/yjs_awareness.ts`
```ts
export function useYjsAwareness(
  noteId: string,
  yDoc: Y.Doc,
  self: { userId: string; displayName: string; color: string }
): Awareness
```

Uses `y-protocols/awareness` to broadcast cursor state. Shares the `note_presence:${noteId}` Supabase channel for cursor positions (extends the existing presence payload).

### `src/components/product/note_crdt_editor.tsx`
The new CodeMirror-based note editor. Wraps `@uiw/react-codemirror` with:
- `yCollab(yText, awareness, { undoManager: new Y.UndoManager(yText) })` extension
- `markdown()` extension
- `EditorView.lineWrapping`
- Theme based on current `mode` prop (`document` or `markdown`)
- `onChange` reads from CodeMirror (not yText directly) — CodeMirror is the source of truth for autosave trigger

### Autosave integration
In `NoteEditor`, after migrating to the CRDT editor:
- `autosaveDebounce` fires on CodeMirror's `onChange`
- Content read from `yText.toString()` (same as CodeMirror's current value)
- `scheduleEmbed(title, yText.toString())` for local indexing

## Packages

| Package | Purpose |
|---------|---------|
| `yjs` | CRDT core — Y.Doc, Y.Text, update encoding |
| `y-codemirror.next` | CodeMirror 6 extension — `yCollab()` |
| `y-protocols` | Awareness protocol (cursor broadcast) |

All three are small; yjs + y-protocols are ~50 KB combined.

## Conflict resolution

Yjs uses a last-write-wins CRDT for text. When two users insert at the same position simultaneously, Yjs uses a stable tiebreaker (client ID) to order them deterministically. The result is always the same on both clients — no conflict dialog, no data loss.

## Limitations — v1

- **No persistent Yjs state server** — document history available only while at least one client is open. Late joiners after everyone disconnects get the DB autosave state (~1.5s lag). Full Yjs persistence requires a Hocuspocus server or Cloudflare Durable Object, deferred to v2.
- **Title not CRDT-bound** — title conflicts still resolved by last-writer-wins autosave. Title edits are rare and brief.
- **Cursor decorations are opt-in** — users can see collaborators' presence without cursor widgets if awareness extension is not mounted.
- **Mobile** — CodeMirror on mobile touch is acceptable but not optimized. Deferred.

## Migration path from textarea

1. `NoteEditor` renders `<NoteCrdtEditor>` instead of the two `<textarea>` elements.
2. `NoteCrdtEditor` accepts `yText` and `awareness` and mounts the CodeMirror instance.
3. All autosave / history / concurrent-edit-warning logic is unchanged — they operate on the string value, agnostic to how it's produced.
4. The textarea markup is removed. Mode toggle becomes a CodeMirror theme swap.
