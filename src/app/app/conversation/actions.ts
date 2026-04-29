"use server";

import { after } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { isWorkspaceOperatorEnabled } from "@/lib/env";
import {
  createBox,
  listBoxesByWorkspace,
} from "@/server/repositories/box_repository";
import { createNote } from "@/server/services/note_service";
import { upsertNoteEmbedding } from "@/server/services/embedding_service";
import {
  best_k_silhouette,
  l2_normalize,
  seedFromString,
} from "@/server/lib/clustering";
import { createDraftBranch } from "@/server/services/branch_service";
import {
  createOperatorRun,
  updateOperatorRun,
  type UpdateOperatorRunPatch,
} from "@/server/services/workspace_operator_runs_service";
import {
  dispatchOperatorRun,
  type OperatorRunResult,
} from "@/server/services/workspace_operator_service";
import { buildPogGraphContext } from "@/server/services/pog_context_service";
import { recordOperatorUsage } from "@/server/services/workspace_operator_usage_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import { safeNotify } from "@/app/app/workspace_operator/actions";
import { operatorRunLimit } from "@/lib/api/rate_limit";
import {
  OPERATOR_MODELS,
  DEFAULT_OPERATOR_MODEL,
  type OperatorModel,
} from "@/app/app/workspace_operator/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface StartConversationTurnInput {
  prompt: string;
  /** When null, the action picks the workspace's first box. */
  boxId: string | null;
  /** Optional model id; validated + defaulted via `resolveModel`. */
  model?: string;
  /** Optional per-run input-token cap forwarded to the agent. */
  maxInputTokens?: number | null;
  /** Optional per-run output-token cap forwarded to the agent. */
  maxOutputTokens?: number | null;
}

export interface StartConversationTurnOutput {
  runId: string;
  branchId: string;
  /** The box id actually used (after default-resolution). */
  boxId: string;
}

// ---------------------------------------------------------------------------
// Helpers. `safeNotify` is re-used via import (it's already exported from the
// workspace_operator actions module); the other `safe*` wrappers are private
// over there, so we keep local copies rather than edit another action file.
// ---------------------------------------------------------------------------

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Validate / normalise a model id passed across the action boundary.
 * Mirrors `resolveModel` in `workspace_operator/actions.ts` — kept local so
 * this action can stay decoupled from that file.
 */
function resolveModel(candidate: string | null | undefined): OperatorModel {
  if (!candidate) return DEFAULT_OPERATOR_MODEL;
  return (OPERATOR_MODELS as readonly string[]).includes(candidate)
    ? (candidate as OperatorModel)
    : DEFAULT_OPERATOR_MODEL;
}

async function safeUpdateRun(
  supabase: Supabase,
  runId: string,
  patch: UpdateOperatorRunPatch
): Promise<void> {
  try {
    await updateOperatorRun(supabase, runId, patch);
  } catch (err) {
    console.error("[conversation] run row update failed", err);
  }
}

async function safeAudit(
  supabase: Supabase,
  params: {
    workspaceId: string;
    actorId: string;
    branchId: string;
    runId: string;
    eventType: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await createAuditEvent(supabase, {
      workspace_id: params.workspaceId,
      actor_type: "user",
      actor_id: params.actorId,
      object_type: "draft_branch",
      object_id: params.branchId,
      event_type: params.eventType,
      metadata: { run_id: params.runId, ...params.metadata },
    });
  } catch (err) {
    console.error("[conversation] audit write failed", err);
  }
}

async function safeRecordUsage(
  supabase: Supabase,
  params: {
    workspaceId: string;
    userId: string;
    result?: OperatorRunResult | null;
  }
): Promise<void> {
  try {
    const result = params.result ?? null;
    await recordOperatorUsage(supabase, {
      workspaceId: params.workspaceId,
      userId: params.userId,
      runCount: 1,
      toolCallCount: result?.tool_calls ?? 0,
      inputTokens: result?.input_tokens ?? 0,
      outputTokens: result?.output_tokens ?? 0,
      model: result?.model,
    });
  } catch (err) {
    console.error("[conversation] usage row record failed", err);
  }
}

// ---------------------------------------------------------------------------
// Background task
// ---------------------------------------------------------------------------

interface BackgroundDispatchInput {
  runId: string;
  workspaceId: string;
  userId: string;
  branchId: string;
  boxId: string;
  prompt: string;
  model: OperatorModel;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
}

/**
 * Runs after the server action's response has already been streamed to the
 * client. Mirrors the post-dispatch persistence that
 * `runWorkspaceOperatorAction` performs inline: audit, status update, usage
 * rollup, notification. Every failure mode is caught so a flake here never
 * crashes the server after the user has received their runId.
 */
async function runDispatchInBackground(
  input: BackgroundDispatchInput
): Promise<void> {
  const supabase = await createClient();
  const startedAt = Date.now();

  // Build the knowledge-graph context block and prepend it to the user's
  // prompt so Pog's system prompt includes the relevant workspace entities
  // and their connected notes. Fails open to an empty string — a graph
  // lookup hiccup must never block dispatch.
  const graphContext = await buildPogGraphContext(
    supabase,
    input.workspaceId,
    input.prompt
  ).catch((err) => {
    console.error(
      "[startConversationTurnAction] graph context failed:",
      err
    );
    return "";
  });
  const augmentedPrompt = graphContext
    ? `${graphContext}\n\n---\n\nUser request: ${input.prompt}`
    : input.prompt;

  let result: OperatorRunResult;
  try {
    result = await dispatchOperatorRun({
      runId: input.runId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      branchId: input.branchId,
      boxId: input.boxId,
      prompt: augmentedPrompt,
      model: input.model,
      maxInputTokens: input.maxInputTokens,
      maxOutputTokens: input.maxOutputTokens,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startedAt;
    await safeAudit(supabase, {
      workspaceId: input.workspaceId,
      actorId: input.userId,
      branchId: input.branchId,
      runId: input.runId,
      eventType: "workspace_operator.dispatch_failed",
      metadata: { error: message, prompt: input.prompt.slice(0, 200) },
    });
    await safeUpdateRun(supabase, input.runId, {
      status: "failed",
      error: message,
      durationMs,
    });
    await safeRecordUsage(supabase, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      result: null,
    });
    await safeNotify(supabase, input.runId, "failed");
    return;
  }

  const durationMs = Date.now() - startedAt;

  await safeUpdateRun(supabase, input.runId, {
    status: result.status === "completed" ? "completed" : "failed",
    result: result as unknown,
    error: result.error ?? null,
    notesCreated: result.notes_created,
    toolCalls: result.tool_calls,
    durationMs,
    inputTokens: result.input_tokens ?? 0,
    outputTokens: result.output_tokens ?? 0,
    cachedInputTokens: result.cached_input_tokens ?? 0,
    model: result.model ?? null,
  });

  await safeNotify(
    supabase,
    input.runId,
    result.status === "completed" ? "completed" : "failed"
  );

  await safeRecordUsage(supabase, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    result,
  });

  await safeAudit(supabase, {
    workspaceId: input.workspaceId,
    actorId: input.userId,
    branchId: input.branchId,
    runId: input.runId,
    eventType:
      result.status === "completed"
        ? "workspace_operator.run_completed"
        : "workspace_operator.run_failed",
    metadata: {
      notes_created: result.notes_created.length,
      tool_calls: result.tool_calls,
      error: result.error ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Public action
// ---------------------------------------------------------------------------

/**
 * Start a conversation turn: create the Operator run + branch and return the
 * `runId` immediately, then dispatch Modal in the background via Next.js'
 * `after()` hook.
 *
 * The chat UX uses the returned `runId` to subscribe to the realtime event
 * stream before Modal has finished — the synchronous
 * `runWorkspaceOperatorAction` blocks until completion, which makes chat
 * feel dead. This action exists so chat can surface "thinking…" state the
 * instant the user presses Enter.
 *
 * The background task is responsible for:
 *   - Calling `dispatchOperatorRun` (the actual Modal HTTP POST)
 *   - Persisting the result (status, notes_created, tool_calls, tokens, …)
 *   - Recording usage
 *   - Writing the audit event
 *   - Sending the completion / failure notification
 *
 * If dispatch fails, the run row is flipped to `status="failed"` with the
 * error message; the chat bubble surfaces this via the realtime subscription.
 */
export async function startConversationTurnAction(
  input: StartConversationTurnInput
): Promise<ActionResult<StartConversationTurnOutput>> {
  try {
    // 1. Feature flag
    if (!isWorkspaceOperatorEnabled()) {
      return {
        ok: false,
        error: "Atlas AI is not enabled for this deployment.",
      };
    }

    // 2. Validate prompt
    const prompt = input.prompt?.trim() ?? "";
    if (!prompt) return { ok: false, error: "Prompt is required." };
    if (prompt.length > 4000) {
      return { ok: false, error: "Prompt must be 4000 characters or fewer." };
    }

    // 3. Auth
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    // 3a. Rate limit AI runs (more expensive than regular writes).
    const rl = await operatorRunLimit(ctx.user.id);
    if (!rl.allowed) {
      return { ok: false, error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` };
    }

    const supabase = await createClient();

    // 4. Resolve box id (or pick the workspace's first available box).
    let boxId = input.boxId?.trim() || null;
    if (!boxId) {
      const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);
      if (boxes.length === 0) {
        return {
          ok: false,
          error:
            "Create your first collection before starting a conversation — Atlas AI drafts notes into a collection.",
        };
      }
      boxId = boxes[0].id;
    } else {
      // Verify the provided box belongs to this workspace — mirrors the
      // fail-fast check in `runWorkspaceOperatorAction` so we don't spend
      // money on Modal before catching an obvious input error.
      const { data: box } = await supabase
        .from("boxes")
        .select("id, workspace_id")
        .eq("id", boxId)
        .maybeSingle();
      if (!box || box.workspace_id !== ctx.workspace.id) {
        return {
          ok: false,
          error: "Target box not found in this workspace.",
        };
      }
    }

    // 5. Resolve model
    const model = resolveModel(input.model);

    // 6. Create the run row (status=queued) — the DB id is the canonical run
    // id we'll send to Modal and return to the client.
    const runRow = await createOperatorRun(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      prompt,
      mode: "full",
      model,
      maxInputTokens: input.maxInputTokens ?? null,
      maxOutputTokens: input.maxOutputTokens ?? null,
    });
    const runId = runRow.id;

    // 7. Create the draft branch the agent will write into.
    const branchName = `agent/${runId.slice(0, 8)}`;
    const branch = await createDraftBranch(supabase, {
      workspace_id: ctx.workspace.id,
      name: branchName,
      description: `Conversation turn ${runId}: ${prompt.slice(0, 200)}`,
      created_by: ctx.user.id,
    });

    // 8. Attach branch + flip to executing so out-of-band readers see a
    // live run.
    await safeUpdateRun(supabase, runId, {
      branchId: branch.id,
      status: "executing",
    });

    // 9. Schedule Modal dispatch + result persistence AFTER the response has
    // been sent. Wrapped in try/catch so a background flake never throws
    // out of the after() callback.
    const backgroundInput: BackgroundDispatchInput = {
      runId,
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      branchId: branch.id,
      boxId,
      prompt,
      model,
      maxInputTokens: input.maxInputTokens ?? null,
      maxOutputTokens: input.maxOutputTokens ?? null,
    };
    after(async () => {
      try {
        await runDispatchInBackground(backgroundInput);
      } catch (err) {
        console.error(
          "[conversation] background dispatch threw unexpectedly",
          err
        );
      }
    });

    // 10. Return immediately — the UI now has the runId and can subscribe
    // to the realtime events channel while Modal is still working.
    return {
      ok: true,
      data: {
        runId,
        branchId: branch.id,
        boxId,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to start conversation turn.",
    };
  }
}

// ---------------------------------------------------------------------------
// Auto-organize: paste notes, get an organized workspace
// ---------------------------------------------------------------------------

export interface AutoOrganizeItem {
  /** Human title, max 200 chars. */
  title: string;
  /** Note body in Markdown. May be empty. */
  markdown: string;
}

export interface AutoOrganizeInput {
  items: AutoOrganizeItem[];
  /** Fallback box name when clustering is skipped (<=5 items or no embedding key). */
  defaultBoxName?: string;
}

export interface AutoOrganizeOutput {
  workspaceId: string;
  boxes: Array<{ id: string; name: string; slug: string; noteCount: number }>;
  totalNotes: number;
  /** k chosen by silhouette, or null when clustering was skipped. */
  clusteredK: number | null;
  /** Best silhouette score, or null when clustering was skipped. */
  silhouette: number | null;
  /** Human-readable note explaining what happened (for the UI to show). */
  summary: string;
}

// ─── Auto-organize constants / helpers (private to this action) ────────────

const AUTO_ORG_EMBEDDING_MODEL = "text-embedding-3-small";
const AUTO_ORG_MAX_ITEMS = 200;
const AUTO_ORG_MAX_TITLE_CHARS = 200;
const AUTO_ORG_MAX_MARKDOWN_CHARS = 50_000;
const AUTO_ORG_EMBED_CHAR_CAP = 8192;
const AUTO_ORG_EMBED_BATCH_SIZE = 100;
const AUTO_ORG_MIN_CLUSTER_SIZE = 6;
const AUTO_ORG_DEFAULT_BOX_NAME = "Inbox";

// Stopwords for TF-IDF cluster labelling — mirrors the list used in
// `propose_box_structure/route.ts`. Kept inline so this action stays a
// pure consumer and doesn't fan out a new shared module.
const AUTO_ORG_STOPWORDS = new Set<string>([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for",
  "with", "as", "is", "it", "its", "at", "by", "from", "this", "that",
  "these", "those", "i", "you", "we", "they", "he", "she", "my", "your",
  "our", "their", "be", "was", "were", "will", "would", "can", "could",
  "should", "are", "am", "been", "being", "do", "does", "did", "have",
  "has", "had", "if", "then", "than", "so", "not", "no", "yes", "into",
  "about", "up", "down", "out", "over", "under", "also", "just", "very",
  "more", "most", "some", "any", "all", "both", "each", "other", "new",
]);

/** Tokenize a title for TF-IDF: lowercase, word-split, drop short/stop. */
function autoOrgTokenize(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !AUTO_ORG_STOPWORDS.has(t));
}

/**
 * Derive a 3-token cluster label via TF-IDF over note titles.
 * Copied from `propose_box_structure/route.ts::labelClusters` to keep
 * this action a pure consumer (per AGENTS.md: don't modify the route).
 */
function autoOrgLabelClusters(clusterTokens: string[][]): string[] {
  const K = clusterTokens.length;
  const df = new Map<string, number>();
  for (const tokens of clusterTokens) {
    const seen = new Set(tokens);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const labels: string[] = [];
  for (const tokens of clusterTokens) {
    if (tokens.length === 0) {
      labels.push("");
      continue;
    }
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const scored: Array<{ token: string; score: number }> = [];
    const total = tokens.length;
    for (const [token, freq] of tf) {
      const dfi = df.get(token) ?? 1;
      const idf = Math.log((1 + K) / (1 + dfi)) + 1;
      scored.push({ token, score: (freq / total) * idf });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3).map((x) => x.token);
    labels.push(top.length > 0 ? top.join(" · ") : "");
  }
  return labels;
}

/**
 * Slugify a label into a string matching the box_schemas slug regex.
 * Must satisfy /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.
 */
function autoOrgSlugify(label: string, fallbackIndex: number): string {
  // `[^a-z0-9]+ → -` covers diacritics, middle-dots, whitespace, etc.,
  // so no explicit NFKD combining-mark strip is needed here. The
  // subsequent trim guarantees the output matches the slug regex:
  // /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) return `cluster-${fallbackIndex}`;
  return cleaned;
}

/**
 * Batch-embed an array of texts via the OpenAI-compatible endpoint.
 * Returns the vectors in the same order as the input, or null if
 * embeddings are unavailable / the API call fails (caller falls back
 * to a single-box import).
 */
async function autoOrgBatchEmbed(
  texts: string[]
): Promise<number[][] | null> {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) return null;
  const baseUrl =
    process.env.EMBEDDING_API_BASE_URL ?? "https://api.openai.com/v1";

  const vectors: number[][] = new Array(texts.length);
  for (let start = 0; start < texts.length; start += AUTO_ORG_EMBED_BATCH_SIZE) {
    const chunk = texts.slice(start, start + AUTO_ORG_EMBED_BATCH_SIZE);
    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AUTO_ORG_EMBEDDING_MODEL,
          input: chunk,
        }),
      });
      if (!response.ok) {
        console.error(
          "[auto_organize] embeddings API error:",
          response.status,
          await response.text().catch(() => "")
        );
        return null;
      }
      const json = (await response.json()) as {
        data?: Array<{ embedding: number[]; index: number }>;
      };
      const rows = json.data ?? [];
      if (rows.length !== chunk.length) {
        console.error(
          "[auto_organize] embeddings API returned",
          rows.length,
          "rows for",
          chunk.length,
          "inputs"
        );
        return null;
      }
      for (const row of rows) {
        const idx = typeof row.index === "number" ? row.index : -1;
        if (idx < 0 || idx >= chunk.length) continue;
        vectors[start + idx] = row.embedding;
      }
      // Guard against missing slots (index out of range or duplicated).
      for (let i = 0; i < chunk.length; i++) {
        if (!vectors[start + i]) {
          console.error(
            "[auto_organize] embeddings API missing vector at batch index",
            i
          );
          return null;
        }
      }
    } catch (err) {
      console.error(
        "[auto_organize] embeddings API call failed:",
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }
  return vectors;
}

/**
 * Paste-notes → organized workspace. Embeds each item, clusters
 * semantically, names each cluster via TF-IDF, creates one box per
 * cluster, and drops each note in its assigned box. Used on first
 * signup — the "aha" moment for new users.
 *
 * Failure modes:
 *   - Missing / broken embedding API: falls back to a single "Inbox"
 *     box containing every note. The response reports `clusteredK: null`.
 *   - <6 items: clustering is skipped (not enough signal).
 *   - Per-note createNote failure: skipped, `totalNotes` reflects the
 *     count that actually landed.
 *   - `upsertNoteEmbedding` failures: swallowed (best-effort so future
 *     semantic search works; must not abort the import).
 */
export async function autoOrganizeWorkspaceAction(
  input: AutoOrganizeInput
): Promise<ActionResult<AutoOrganizeOutput>> {
  try {
    // 1. Validate input shape.
    const items = Array.isArray(input?.items) ? input.items : null;
    if (!items || items.length === 0) {
      return { ok: false, error: "At least one note is required." };
    }
    if (items.length > AUTO_ORG_MAX_ITEMS) {
      return {
        ok: false,
        error: `Too many notes (max ${AUTO_ORG_MAX_ITEMS}).`,
      };
    }
    const normalized: AutoOrganizeItem[] = [];
    for (const raw of items) {
      const title = typeof raw?.title === "string" ? raw.title.trim() : "";
      const markdown = typeof raw?.markdown === "string" ? raw.markdown : "";
      if (!title) {
        return { ok: false, error: "Every note must have a non-empty title." };
      }
      if (title.length > AUTO_ORG_MAX_TITLE_CHARS) {
        return {
          ok: false,
          error: `Title exceeds ${AUTO_ORG_MAX_TITLE_CHARS} characters.`,
        };
      }
      if (markdown.length > AUTO_ORG_MAX_MARKDOWN_CHARS) {
        return {
          ok: false,
          error: `Note body exceeds ${AUTO_ORG_MAX_MARKDOWN_CHARS} characters.`,
        };
      }
      normalized.push({ title, markdown });
    }

    // 2. Auth.
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const workspaceId = ctx.workspace.id;
    const userId = ctx.user.id;
    const defaultBoxName =
      (input.defaultBoxName?.trim() || AUTO_ORG_DEFAULT_BOX_NAME);

    // 3. Embed all items (batched). A null return == fall back to
    // single-box import; not a hard failure.
    const embedInputs = normalized.map((n) => {
      const combined = `${n.title}\n\n${n.markdown}`;
      return combined.slice(0, AUTO_ORG_EMBED_CHAR_CAP);
    });
    const embeddings =
      normalized.length >= AUTO_ORG_MIN_CLUSTER_SIZE
        ? await autoOrgBatchEmbed(embedInputs)
        : null;

    // 4. Decide clustering plan.
    //    assignments[i] = cluster index for item i (0..K-1)
    //    clusterLabels[c] = human-readable label for cluster c
    let assignments: number[];
    let clusterLabels: string[];
    let clusteredK: number | null = null;
    let silhouette: number | null = null;

    if (
      embeddings === null ||
      normalized.length < AUTO_ORG_MIN_CLUSTER_SIZE
    ) {
      // Fallback: single bucket, all notes in one box.
      assignments = new Array(normalized.length).fill(0);
      clusterLabels = [defaultBoxName];
    } else {
      // L2-normalize embeddings (in place on our copy) then cluster.
      const X = embeddings.map((v) => l2_normalize(v.slice()));
      const kUpper = Math.max(
        2,
        Math.min(8, Math.floor(Math.sqrt(normalized.length / 2)))
      );
      const kRange: number[] = [];
      for (let k = 2; k <= kUpper; k++) kRange.push(k);
      const seed = seedFromString(workspaceId);
      const best = best_k_silhouette(X, kRange, { seed });

      assignments = best.labels;
      clusteredK = best.k;
      silhouette = Number.isFinite(best.silhouette) ? best.silhouette : null;

      // Label each cluster via TF-IDF over member titles.
      const tokensPerCluster: string[][] = Array.from(
        { length: best.k },
        () => []
      );
      for (let i = 0; i < normalized.length; i++) {
        const c = assignments[i];
        if (c >= 0 && c < best.k) {
          tokensPerCluster[c].push(...autoOrgTokenize(normalized[i].title));
        }
      }
      const rawLabels = autoOrgLabelClusters(tokensPerCluster);
      clusterLabels = rawLabels.map((lbl, idx) =>
        lbl.length > 0 ? lbl : `Cluster ${idx + 1}`
      );
    }

    const K = clusterLabels.length;

    // 5. Create boxes — sequential so slug-uniqueness is respected.
    //    Pre-load existing slugs to avoid a round-trip per name.
    const { data: existingBoxes } = await supabase
      .from("boxes")
      .select("slug")
      .eq("workspace_id", workspaceId);
    const usedSlugs = new Set<string>(
      (existingBoxes ?? []).map((b: { slug: string }) => b.slug)
    );

    interface CreatedBoxInfo {
      id: string;
      name: string;
      slug: string;
      clusterIndex: number;
    }
    const createdBoxes: CreatedBoxInfo[] = [];
    for (let c = 0; c < K; c++) {
      const name = clusterLabels[c];
      const baseSlug = autoOrgSlugify(name, c + 1);
      let slug = baseSlug;
      let suffix = 2;
      while (usedSlugs.has(slug)) {
        slug = `${baseSlug}-${suffix++}`;
      }
      try {
        const box = await createBox(supabase, {
          workspace_id: workspaceId,
          name,
          slug,
          description: "Auto-organized from import",
        });
        usedSlugs.add(slug);
        createdBoxes.push({
          id: box.id,
          name: box.name,
          slug: box.slug,
          clusterIndex: c,
        });
      } catch (err) {
        console.error(
          "[auto_organize] createBox failed for cluster",
          c,
          err instanceof Error ? err.message : err
        );
        // Roll forward — the summary will reflect what actually landed.
      }
    }

    // Seed a guide note in the fallback Inbox box so new users understand
    // how to use it. Only fires when clustering was skipped and a single
    // default Inbox box was created.
    if (clusteredK === null && createdBoxes.length === 1) {
      const inboxBox = createdBoxes[0];
      const INBOX_GUIDE_CONTENT = `# Your Inbox — how it works

This is your capture zone. Anything you save quickly — from your phone, browser, or voice — lands here first.

**How to use it:**
- Drop raw thoughts here, then move them to the right box later
- Use the "Ask AI" conversation to triage: "Organize my inbox notes into the right collections"
- Notes here show up in workspace-wide searches immediately

**Tip:** Keep this collection for unprocessed captures. When it grows past ~20 notes, ask Atlas AI to help you sort them.`;
      try {
        await createNote(supabase, userId, workspaceId, {
          boxId: inboxBox.id,
          title: "How your Inbox works",
          markdownContent: INBOX_GUIDE_CONTENT,
          kind: "guide",
        });
      } catch (guideErr) {
        // Non-fatal: boxes and notes were created; log and continue.
        console.error("[auto_organize] Failed to seed Inbox guide note", guideErr);
      }
    }

    // Map cluster index → box id for note placement. Clusters whose
    // box creation failed simply drop their notes.
    const clusterIndexToBoxId = new Map<number, string>();
    for (const b of createdBoxes) {
      clusterIndexToBoxId.set(b.clusterIndex, b.id);
    }

    // 6. Create notes — each in its assigned box. Failures skip.
    const noteCountByBox = new Map<string, number>();
    let totalNotes = 0;
    const createdNoteIds: Array<{ noteId: string; content: string }> = [];
    for (let i = 0; i < normalized.length; i++) {
      const boxId = clusterIndexToBoxId.get(assignments[i]);
      if (!boxId) continue;
      const item = normalized[i];
      try {
        const note = await createNote(supabase, userId, workspaceId, {
          boxId,
          title: item.title,
          markdownContent: item.markdown,
        });
        totalNotes++;
        noteCountByBox.set(boxId, (noteCountByBox.get(boxId) ?? 0) + 1);
        createdNoteIds.push({
          noteId: note.id,
          content: `${item.title}\n\n${item.markdown}`,
        });
      } catch (err) {
        console.error(
          "[auto_organize] createNote failed",
          err instanceof Error ? err.message : err
        );
      }
    }

    // 7. Best-effort embedding upsert so future semantic search works.
    //    Failures are swallowed — must not abort the import — but we count
    //    them so the summary can surface a search-quality warning to the user.
    let embeddingFailures = 0;
    for (const { noteId, content } of createdNoteIds) {
      try {
        await upsertNoteEmbedding(supabase, noteId, content);
      } catch (err) {
        embeddingFailures++;
        console.error(
          "[auto_organize] upsertNoteEmbedding failed for",
          noteId,
          err instanceof Error ? err.message : err
        );
      }
    }

    // 8. Build response.
    const boxesOut = createdBoxes.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      noteCount: noteCountByBox.get(b.id) ?? 0,
    }));

    let summary: string;
    if (clusteredK !== null && silhouette !== null) {
      summary = `Organized ${totalNotes} notes into ${boxesOut.length} boxes (silhouette ${silhouette.toFixed(2)})`;
    } else if (clusteredK !== null) {
      summary = `Organized ${totalNotes} notes into ${boxesOut.length} boxes`;
    } else {
      const s = totalNotes === 1 ? "" : "s";
      summary = `Imported ${totalNotes} note${s} into a single '${defaultBoxName}' box.`;
    }
    if (boxesOut.length === 0) {
      summary = `Imported ${totalNotes} note(s); no boxes were created.`;
    }
    if (embeddingFailures > 0) {
      summary += ` (${embeddingFailures} note${embeddingFailures === 1 ? "" : "s"} couldn't be indexed for search — check EMBEDDING_API_KEY)`;
    }

    return {
      ok: true,
      data: {
        workspaceId,
        boxes: boxesOut,
        totalNotes,
        clusteredK,
        silhouette,
        summary,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to auto-organize workspace.",
    };
  }
}
