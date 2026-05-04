# Performance Budget v1

> Targets are budgets, not aspirations. If a route ships outside its budget, it
> doesn't merge — or it merges with an explicit waiver linked from the PR
> description. Budgets are reviewed quarterly and tightened when we beat them
> for two cycles running.

## What this document is

A single source of truth for the latency, bundle-size, and resource budgets we
hold ourselves to per route class. It gives reviewers a fast yes/no on
"is this PR within budget?" and gives engineers a target before they start
optimising.

Budgets are split by **route class** (the type of work the route does), not by
specific URL — adding a new agent detail page should inherit the
`detail-server-component` budget without any extra writing.

## Measurement methodology

| Signal | Tool | Window |
|---|---|---|
| **TTFB** (server) | Vercel Analytics + Sentry tracing | Rolling 7d |
| **LCP** (client) | Vercel Web Vitals | Rolling 28d |
| **INP** (client) | Vercel Web Vitals | Rolling 28d |
| **JS / CSS bundle** | `next build` size report (per-route) | Per PR (CI gate) |
| **Server-action latency** | Sentry tracing on the action span | Rolling 7d |
| **DB query p95** | Supabase logs + custom span instrumentation | Rolling 7d |
| **Cold-boot latency** | `pnpm bench:routes` (synthetic, US-east) | Per release |

p50, p95, and p99 are computed from the underlying tool's distribution. CI
fails when the p95 of a route class regresses by **>15%** for two consecutive
deploys, or when a single PR's synthetic benchmark exceeds the route-class
budget by **>20%**.

## Route class budgets

### Class A — Marketing pages (static / ISR)

| Metric | p50 | p95 | p99 |
|---|---:|---:|---:|
| TTFB | 50 ms | 120 ms | 250 ms |
| LCP | 800 ms | 1.8 s | 2.5 s |
| INP | 80 ms | 200 ms | 500 ms |
| JS (initial) | 90 KB | — | 140 KB |
| CSS (initial) | 18 KB | — | 30 KB |

Routes: `(marketing)/*`. ISR for content pages, static for legal.

### Class B — Auth surfaces (sign-in, reset, OAuth, capture, share)

| Metric | p50 | p95 | p99 |
|---|---:|---:|---:|
| TTFB | 120 ms | 300 ms | 600 ms |
| LCP | 1.0 s | 2.2 s | 3.0 s |
| Server action (form submit) | 250 ms | 700 ms | 1.5 s |
| JS (initial) | 110 KB | — | 170 KB |

Routes: `/sign_in`, `/reset-password`, `/oauth/*`, `/capture`, `/share/*`,
`/welcome`, `/invite/*`.

### Class C — App shell (layout + topbar + sidebar bootstrapping)

| Metric | p50 | p95 | p99 |
|---|---:|---:|---:|
| TTFB | 200 ms | 500 ms | 1.0 s |
| LCP | 1.2 s | 2.5 s | 3.5 s |
| INP | 100 ms | 250 ms | 600 ms |
| JS (initial) | 180 KB | — | 260 KB |

The shell carries the auth gate, workspace bootstrap, recent-notes fetch,
boxes-list fetch, and pending-proposals fetch — five concurrent server
queries. The budget assumes those run in parallel via `Promise.all`.

### Class D — List pages (`/skills`, `/agents`, `/workflows`, `/branches`, `/proposals`, `/audit`, `/activity`, `/insights`)

| Metric | p50 | p95 | p99 |
|---|---:|---:|---:|
| TTFB | 250 ms | 600 ms | 1.2 s |
| LCP | 1.4 s | 2.8 s | 4.0 s |
| Server query (per list) | 120 ms | 350 ms | 700 ms |
| Cursor-paginated next page | 80 ms | 200 ms | 400 ms |

### Class E — Detail pages (note editor, file viewer, agent detail, box detail, skill detail, folder detail, run detail)

| Metric | p50 | p95 | p99 |
|---|---:|---:|---:|
| TTFB | 300 ms | 800 ms | 1.6 s |
| LCP | 1.6 s | 3.2 s | 4.5 s |
| INP (editor keystroke) | 30 ms | 80 ms | 200 ms |
| Server action (autosave) | 200 ms | 600 ms | 1.2 s |
| First CRDT sync | 200 ms | 500 ms | 1.0 s |

Editor keystroke INP is the *strictest* budget in the system — anything above
the p99 is a regression we ship a hotfix for, not a follow-up. The CRDT path
has its own budget because it's user-perceptible (presence cursors).

### Class F — Mutation server actions (writes, deletes, lifecycle changes)

| Metric | p50 | p95 | p99 |
|---|---:|---:|---:|
| Action latency | 200 ms | 600 ms | 1.5 s |
| DB write | 30 ms | 100 ms | 300 ms |
| Audit-log append | 10 ms | 40 ms | 100 ms |
| Webhook-fanout enqueue | 10 ms | 50 ms | 150 ms |

The webhook fanout itself is async (Inngest) and not budgeted on the request
path. The enqueue must be fast.

### Class G — API v1 (REST) and MCP tools

| Metric | p50 | p95 | p99 |
|---|---:|---:|---:|
| Read endpoint | 80 ms | 200 ms | 500 ms |
| Search endpoint | 150 ms | 400 ms | 1.0 s |
| Bundle export | 800 ms | 2.5 s | 6.0 s |
| MCP tool call | 100 ms | 300 ms | 800 ms |

Bundle export is the only endpoint allowed to exceed 1s on p95 — it composes
many notes into a single payload and is bound by I/O, not CPU. It runs on a
Cloudflare Worker, off the main request path.

### Class H — Background workers

| Job | p95 duration | SLA |
|---|---:|---|
| Embedding worker (per note) | 2 s | Eventually consistent within 60 s of save |
| Diff worker (per version) | 800 ms | Eventually consistent within 30 s |
| Webhook delivery (per attempt) | 3 s | Up to 5 retries with exponential backoff |
| Branch retention sweep | 30 s | Daily, off-peak |
| KG entity extraction (per note) | 5 s | Eventually consistent within 300 s |

## Bundle-size budgets

The shadcn/ui primitives compile down small. Watch for **regressions**, not
absolute size — a 12% jump in the shell bundle is a signal to investigate.

| Bundle | Soft cap | Hard cap |
|---|---:|---:|
| `(marketing)` shared chunk | 90 KB | 140 KB |
| `/app` shell chunk | 180 KB | 260 KB |
| Per-page additive | 40 KB | 70 KB |
| Total CSS (after Tailwind purge) | 35 KB | 55 KB |

Bundle CI: `pnpm next build && pnpm size-limit` (the latter wraps the per-route
report; failures block merge).

## Memory & resource budgets

| Resource | Budget | Notes |
|---|---:|---|
| Edge function memory | 128 MB | Most pages; raise to 256 MB only with justification |
| Server Component fetch parallelism | 8 concurrent | Anything beyond becomes a service-level batch |
| Client `useEffect` count per page | < 12 | Surfaced via lint warning |
| Realtime channels per session | < 4 | Workspace + box + note + presence; further channels share |

## How to measure locally

```bash
# Synthetic benchmark for marketing + auth + a representative app page.
pnpm bench:routes

# Per-route bundle report.
pnpm next build && pnpm size-limit

# CRDT/INP keystroke benchmark for the editor.
pnpm bench:editor

# Lighthouse CI against the marketing pages (mobile profile).
pnpm bench:lhci
```

The `bench:*` scripts live in `scripts/bench/` and emit a JSON snapshot to
`./bench-output/<git-sha>.json` for trend tracking.

## Reviewing performance work

Open the PR description with a single line: **"Within the X budget at p95: Y
ms (was Z ms)."** If the PR moves a budget, link the prior numbers and the
proposed numbers. If a budget can't be hit, write the waiver in the PR
description, set a calendar item to revisit, and link the issue.

## Roadmap

- v1.1: Per-region budgets (US-east is the baseline; EU + APAC pending data residency rollout)
- v1.2: Cost budgets per request class (LLM tokens, web-tool spend, embedding tokens)
- v1.3: Mobile-network budgets (Slow 3G + Fast 4G profiles for marketing + auth)
- v2.0: Closed-loop budget enforcement — synthetic regressions auto-create issues with a 7-day SLA
