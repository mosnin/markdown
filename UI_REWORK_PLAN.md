# UI Rework Plan — Context OS for AI Agents

## The Thesis

The current UI tells the story of a note-taking app with AI features.
The new UI must tell the story of a context operating system that humans manage.

Every surface gets re-examined through one question:
> **"Does this help a human curate, monitor, or approve context for AI agents?"**

If yes — it earns prominence. If no — it moves to the periphery.

---

## Phase 1 — Navigation & Information Architecture

**The current nav structure:**
```
Primary
├── Home (AI chat)
└── AI Edits

Build
├── Skills
├── Agents
├── Workflows
└── Branches

Explore
└── Knowledge Graph
```

**The new nav structure:**
```
Context
├── Contexts          ← was "Home" — now a Box grid (primary surface)
└── Approvals         ← was "AI Edits" — renamed, reframed as the trust layer

Build
├── Skills
├── Agents
├── Workflows
└── Branches

Explore
└── Knowledge Graph

[Footer]
├── Atlas AI          ← still accessible but secondary, not the homepage
├── Connections       ← new: MCP endpoints, connected external agents
├── Settings
└── User menu
```

### Key decisions:
- **"Home" → "Contexts"**: The Box grid is now the first thing you see. This is the control plane.
- **"AI Edits" → "Approvals"**: The rename positions this as the trust mechanism, not a feature. Approvals are infrastructure, not notifications.
- **Atlas AI demoted from home**: Still first-class, accessible via footer or keyboard shortcut (`Cmd+K` → "Open Atlas AI"). But it's a tool you reach for, not the landing surface.
- **"Connections" added to footer**: The MCP endpoints and external agent management surface. This is where engineers connect their agents to Poggle.
- **Build section stays full visibility**: Skills, Agents, Workflows, Branches remain as first-class nav items — right call for this audience.

---

## Phase 2 — Home Screen: The Context Workspace

**Current**: AI conversation panel (OperatorPanel mode="page")

**New**: Box grid — the context domain control plane

### Layout:
```
┌─────────────────────────────────────────────────────────┐
│  Contexts                              [+ New Context]   │
│  3 domains · 2 agents connected · 1 pending approval     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────┐  ┌──────────────────┐             │
│  │ 📁 Product Specs │  │ 📁 Customer Intel │  ...        │
│  │                  │  │                  │             │
│  │ 42 notes         │  │ 18 notes         │             │
│  │ 2 agents active  │  │ 1 agent active   │             │
│  │ Last read: 2m ago│  │ Last read: 1h ago│             │
│  │ ● 3 proposals    │  │ ✓ All approved   │             │
│  └──────────────────┘  └──────────────────┘             │
│                                                          │
│  Recent Activity                         [View all →]    │
│  ─────────────────────────────────────────────────────  │
│  Atlas AI read "API Architecture" · 2 min ago           │
│  Atlas AI proposed update to "Pricing" · 5 min ago  ●  │
│  ExternalAgent read "Customer Personas" · 12 min ago    │
└─────────────────────────────────────────────────────────┘
```

### Box Card anatomy:
- Box name + icon
- Note count
- Agent count (how many agents have access)
- Last context read timestamp (agent activity signal)
- Pending proposals count (with alert dot if > 0)
- Quick action: Open Box / Open in Atlas AI

### The "pending proposals" signal is critical:
This is the primary call-to-action for the non-technical curator. One glance at the home screen tells them: *"Two of your context domains have agent-proposed changes waiting for your review."* That is the job.

---

## Phase 3 — Box Detail: Context Domain View

**Current**: Box detail shows a note tree, nothing agent-specific.

**New**: Box detail is a context domain management surface.

### Tabs:
1. **Notes** (current) — the content, now with agent-read indicators
2. **Agents** (new) — which agents have access to this Box, recent activity per agent
3. **Approvals** (new) — proposals scoped to this Box only
4. **Settings** (new) — guide note, agent instructions, access controls, retrieval config

### Note list changes:
- Small "agent eye" indicator on notes that agents have read recently
- Retrieval priority visible inline (not buried in settings)
- Proposal pending indicator on notes with unreviewed agent suggestions

---

## Phase 4 — Approvals: Reframing the Trust Layer

**Current**: "AI Edits" — feels like a feature, reads like a changelog.

**New**: "Approvals" — feels like governance, reads like infrastructure.

### Layout overhaul:
```
┌──────────────────────────────────────────────────────────┐
│  Approvals                                               │
│  4 pending · 2 approved today · 0 rejected               │
├──────────────────────────────────────────────────────────┤
│  PENDING                                                 │
│  ─────────────────────────────────────────────────────  │
│  ● Update "Pricing Strategy"                             │
│    Atlas AI · Product Specs box · 3 min ago              │
│    Proposed: added Q3 pricing tiers from context search  │
│    [Preview diff]  [Approve]  [Reject]                   │
│                                                          │
│  ● Create "Competitor Analysis — Segment"                │
│    Atlas AI · Customer Intel box · 8 min ago             │
│    Proposed: new note synthesizing 4 retrieved notes     │
│    [Preview diff]  [Approve]  [Reject]                   │
├──────────────────────────────────────────────────────────┤
│  APPROVED TODAY                                          │
│  ─────────────────────────────────────────────────────  │
│  ✓ Updated "API Rate Limits" · approved 1h ago           │
└──────────────────────────────────────────────────────────┘
```

### Key changes:
- Clear proposal header: which agent, which box, when
- One-line rationale from the agent
- Inline diff preview (don't open a new page to review)
- Approve/Reject in one click — no confirmation modal for approve, light confirmation for reject
- Batch approve (checkbox select + "Approve selected") for power curators

---

## Phase 5 — Connections: The Developer Surface

**New page** — accessible from sidebar footer.

This is where engineers live. It's explicitly infrastructure language.

### Sections:
1. **MCP Endpoints** — your workspace MCP server URL, auth tokens, connection status
2. **Connected Agents** — list of external agents that have connected, last seen, read/write permissions per Box
3. **API Keys** — workspace API keys for programmatic access
4. **Webhook Events** — configure outbound webhooks for agent events (proposal created, note updated, etc.)
5. **Usage** — context reads, proposals, token consumption by agent

### The MCP endpoint display:
```
Your MCP Endpoint
─────────────────────────────────────────────
https://api.poggle.app/mcp/ws/{workspace_id}

Authorization: Bearer {your-api-key}

Connect in Claude Desktop:
{
  "mcpServers": {
    "poggle": {
      "url": "https://api.poggle.app/mcp/ws/{workspace_id}",
      "apiKey": "{your-api-key}"
    }
  }
}

[Copy config]  [Regenerate key]
```

This is the equivalent of Stripe's API keys page. It should look and feel that precise.

---

## Phase 6 — Note Detail: Agent-Aware Context View

The note editor stays. The right panel changes.

### Right panel tabs (new framing):
1. **Context** — same as now: metadata, links, backlinks. Add: which agents have read this note.
2. **Proposals** — proposals scoped to this note only (was: "AI" tab general).
3. **History** — version history with agent attribution (which agent wrote which version).

### New "Agent Reads" section in Context tab:
```
Agent Activity
─────────────────────────────
Atlas AI read · 2 min ago     (from: "pricing analysis" run)
ExternalAgent read · 1h ago   (from: MCP context request)
```

Small, informational, non-intrusive. Tells the curator: *"This note is being used."*

---

## Phase 7 — Atlas AI: Repositioned as a Tool

**Current**: Homepage. The first thing you see.

**New**: Accessible via:
- Sidebar footer button
- Global keyboard shortcut (`Cmd+J` or `Cmd+K` → "Open Atlas AI")
- "Open in Atlas AI" button on Box cards and notes
- Persistent floating button (optional, settings-controlled)

The conversation UI itself doesn't change — it's already well-built. What changes is its position in the hierarchy. It's a power tool you reach for, not a lobby you walk through.

---

## Phase 8 — Empty State & First-Run Onboarding

**Current**: Empty workspace → AI conversation → blank.

**New**: Two-track onboarding based on role.

### Track A — Developer setup:
```
Welcome to Poggle.
Your context OS for AI agents.

Step 1: Create your first context domain
Step 2: Add some context (import or create notes)
Step 3: Connect your first agent (MCP config below)
Step 4: Watch your agent read and propose

[Create first context]        [View MCP docs]
```

### Track B — Curator onboarding:
```
You've been added to [Workspace Name].

Your role: Context curator.
Your job: Review and approve what agents propose to write.

You have [N] pending approvals.

[Review approvals]         [Explore context domains]
```

---

## Phase 9 — Language & Terminology Audit

Every instance of the old language gets updated to agent-first framing.

| Old term | New term | Reason |
|----------|----------|--------|
| Home | Contexts | It's a control plane, not a dashboard |
| AI Edits | Approvals | It's a governance surface, not a diff viewer |
| Box | Context Domain | More precise; reinforces infrastructure framing |
| Notes | Context Notes | Subtle — keeps "notes" but adds the qualifier |
| Workspace Operator | Atlas AI | Already done; consistent everywhere |
| "Ask AI" button | "Atlas AI" button | Name the thing |
| AI tab (note panel) | Proposals | What it actually shows |

---

## Implementation Sequence

### Week 1 — Foundation
- [ ] Phase 1: Navigation restructure (rename + reorder, add Connections placeholder)
- [ ] Phase 8: Terminology audit across all pages and components

### Week 2 — Home Screen
- [ ] Phase 2: Home → Context Workspace (Box grid with agent-aware metadata)
- [ ] Requires: box-level agent activity data (reads, proposal count)

### Week 3 — Approvals Surface
- [ ] Phase 4: Approvals page redesign (inline diff, batch approve)
- [ ] Phase 3: Box detail → add Agents tab + Approvals tab

### Week 4 — Developer Surface
- [ ] Phase 5: Connections page (MCP endpoint, connected agents, API keys)
- [ ] Phase 6: Note detail → agent reads, proposal scoping

### Week 5 — Positioning + Polish
- [ ] Phase 7: Atlas AI repositioned (footer, keyboard shortcut, contextual open)
- [ ] Phase 8: Onboarding flows (developer track + curator track)
- [ ] Marketing/sign-in page: "Context OS for AI agents" positioning

---

## What Does NOT Change

- The editor (CodeMirror + Yjs CRDT) — already excellent
- The Build section (Skills, Agents, Workflows, Branches) — full visibility, stays as-is
- The Knowledge Graph — keep as Explore section
- The underlying data model — Boxes, Notes, links, versions, branches are correct
- The Quiet Power design system — enterprise aesthetic is right for this audience
- Atlas AI conversation UX — plan/approve/execute flow is correct

The architecture is sound. The rework is a story problem, not an engineering problem. We're not rebuilding — we're re-labeling and re-prioritizing.
