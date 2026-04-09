# Context Store

A structured, markdown-native context operating system for humans and AI.

Context Store is not a generic notes app. It is an opinionated system for capturing, organizing, and serving structured context — to yourself and to AI agents — through a clear information hierarchy: **workspaces → boxes → folders → notes / guides / bundles**.

---

## Local development

### Prerequisites

- Node.js 20+
- pnpm 9+
- A Supabase project (free tier is fine)

### Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment variables and fill in Supabase credentials
cp .env.example .env.local
```

Edit `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Supabase project configuration** (one-time, in the Supabase dashboard):

1. **Enable Email OTP** — Authentication → Providers → Email → enable "Email OTP"
2. **Add redirect URL** — Authentication → URL Configuration → Redirect URLs → add `http://localhost:3000/auth/callback`
3. **Set site URL** — Authentication → URL Configuration → Site URL → `http://localhost:3000`

```bash
# 3. Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in at [http://localhost:3000/sign_in](http://localhost:3000/sign_in).

### Available commands

| Command | Description |
|---|---|
| `pnpm dev` | Start local dev server with HMR |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm lint` | Run ESLint |

---

## Project status

### Implemented

- [x] Next.js 16 App Router with TypeScript and Tailwind v4
- [x] shadcn/ui component library (Base UI backend)
- [x] Light / dark mode with next-themes
- [x] Design token system in `globals.css`
- [x] Application shell (sidebar, header, main, right panel)
- [x] Routes: `/`, `/app`, `/app/workspaces`, `/app/boxes/[box_id]`, `/app/notes/[note_id]`, `/app/settings`
- [x] Product UI components (tree, note card, metadata panel, empty state)
- [x] **Supabase Auth with email magic link**
- [x] **Session proxy middleware for token refresh**
- [x] **Server-side route protection on `/app`**
- [x] **Request context foundation (`getRequestContext`)**
- [x] **Sign in / sign out flow**

### Not yet implemented

- [ ] Database schema and migrations
- [ ] Real workspace / box / note data
- [ ] Markdown editor
- [ ] REST API endpoints
- [ ] MCP server
- [ ] Import / export
- [ ] OAuth providers
- [ ] Role-based permissions

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
See [docs/auth.md](docs/auth.md) for the auth architecture and setup guide.
See [docs/design_system.md](docs/design_system.md) for UI rules and component guidance.
