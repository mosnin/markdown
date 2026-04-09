# Context Store

A structured, markdown-native context operating system for humans and AI.

Context Store is not a generic notes app. It is an opinionated system for capturing, organizing, and serving structured context — to yourself and to AI agents — through a clear information hierarchy: **workspaces → boxes → folders → notes / guides / bundles**.

---

## Local development

### Prerequisites

- Node.js 20+
- pnpm 9+

### Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment variables
cp .env.example .env.local
# Fill in Supabase credentials when the database prompt is implemented.
# The app runs without them for now (no auth, no data persistence).

# 3. Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Available commands

| Command | Description |
|---|---|
| `pnpm dev` | Start local dev server with HMR |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm lint` | Run ESLint |

---

## Project status

This is the **foundation prompt** result. The following is in place:

- [x] Next.js 16 App Router with TypeScript and Tailwind v4
- [x] shadcn/ui component library
- [x] Light / dark mode with next-themes
- [x] Design token system in `globals.css`
- [x] Application shell (sidebar, header, main, right panel)
- [x] Routes: `/`, `/app`, `/app/workspaces`, `/app/boxes/[box_id]`, `/app/notes/[note_id]`, `/app/settings`
- [x] Product UI components (tree, note card, metadata panel, empty state)
- [x] Folder structure for backend, services, and MCP

The following is **not yet implemented**:

- [ ] Supabase auth
- [ ] Database schema and migrations
- [ ] Real data fetching
- [ ] Markdown editor
- [ ] API endpoints
- [ ] MCP server
- [ ] Import / export

---

## Information architecture

```
Workspace
  └── Box
        ├── Folder
        │     ├── Note
        │     ├── Guide note
        │     └── Context bundle
        ├── Note (root-level)
        └── Context bundle (root-level)
```

See [docs/architecture.md](docs/architecture.md) for the full module layout.
See [docs/design_system.md](docs/design_system.md) for UI rules and component guidance.
