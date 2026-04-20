import { type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  parseOperatorBearer,
  verifyApiKey,
} from "@/server/services/operator_api_keys_service";
import { checkOperatorQuota } from "@/server/services/workspace_operator_quota_service";
import { checkApiRateLimit } from "@/server/services/operator_rate_limit_service";
import {
  createOperatorRun,
  updateOperatorRun,
} from "@/server/services/workspace_operator_runs_service";
import {
  dispatchOperatorRun,
  dispatchOperatorPlan,
  dispatchOperatorExecute,
  type OperatorRunResult,
} from "@/server/services/workspace_operator_service";
import { createDraftBranch } from "@/server/services/branch_service";
import { isWorkspaceOperatorEnabled } from "@/lib/env";
import { recordOperatorUsage } from "@/server/services/workspace_operator_usage_service";
import {
  OPERATOR_MODELS,
  DEFAULT_OPERATOR_MODEL,
  type OperatorModel,
} from "@/app/app/workspace_operator/types";

/**
 * POST /api/operator/runs
 *
 * External entry point — dispatches a Workspace Operator run using a
 * `wopr_` bearer API key for authentication. The cookie-session path
 * stays in `src/app/app/workspace_operator/actions.ts`; this route is
 * the integration surface for scripts, CI, and external automation.
 *
 * ─── Authentication ──────────────────────────────────────────────────────
 *
 *   Authorization: Bearer wopr_<32 hex chars>
 *
 * The key resolves to a (user_id, workspace_id) pair via
 * `verifyApiKey`. Missing / malformed / revoked keys all return 401
 * with the same opaque message — we never leak which step failed.
 *
 * ─── Request body (JSON) ─────────────────────────────────────────────────
 *
 *   {
 *     "prompt": "Draft notes about Q1 wins",
 *     "mode":   "plan" | "execute" | "full",
 *     "branchId":  "<uuid>"  // optional — caller-provided branch
 *     "boxId":     "<uuid>"  // required for "full" / "execute"
 *     "model":           "<string>"  // optional model hint, currently unused
 *     "maxInputTokens":  <int>       // optional, currently unused
 *     "maxOutputTokens": <int>       // optional, currently unused
 *   }
 *
 * `model` / `maxInputTokens` / `maxOutputTokens` are accepted for
 * forward-compat with the Wave 2 dispatch surface. They are echoed
 * onto the run row via the run's `result` jsonb so callers can grep
 * for them but the underlying Modal dispatcher does not yet honour them.
 *
 * ─── Quota ───────────────────────────────────────────────────────────────
 *
 * `checkOperatorQuota` runs before dispatch and returns 429 with a
 * structured envelope when the caller has exhausted their per-tier
 * monthly run cap. The REST endpoint MUST NOT bypass quota — that is
 * the security invariant for this surface.
 */

export const runtime = "nodejs";

interface DispatchBody {
  prompt?: unknown;
  mode?: unknown;
  branchId?: unknown;
  boxId?: unknown;
  model?: unknown;
  maxInputTokens?: unknown;
  maxOutputTokens?: unknown;
}

interface DispatchInput {
  prompt: string;
  mode: "plan" | "execute" | "full";
  branchId: string | null;
  boxId: string | null;
  model: string | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
}

function asTrimmedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/**
 * Narrow an arbitrary model hint from the REST body to the allowlist.
 * Mirrors `resolveModel` in `actions.ts` — duplicated at the boundary
 * so a Free-tier caller can't escalate to `gpt-4.1` by passing the
 * string through the REST surface. Unknown or missing → default.
 */
function resolveRestModel(value: unknown): OperatorModel {
  if (typeof value !== "string") return DEFAULT_OPERATOR_MODEL;
  const trimmed = value.trim();
  return (OPERATOR_MODELS as readonly string[]).includes(trimmed)
    ? (trimmed as OperatorModel)
    : DEFAULT_OPERATOR_MODEL;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function parseBody(raw: DispatchBody): { ok: true; input: DispatchInput } | { ok: false; message: string } {
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) return { ok: false, message: "prompt is required" };
  if (prompt.length > 4000) {
    return { ok: false, message: "prompt must be 4000 characters or fewer" };
  }
  const mode = raw.mode;
  if (mode !== "plan" && mode !== "execute" && mode !== "full") {
    return { ok: false, message: "mode must be one of plan|execute|full" };
  }
  const branchId = asTrimmedString(raw.branchId, 64);
  const boxId = asTrimmedString(raw.boxId, 64);
  // execute / full need a box to draft into; plan can stand alone with
  // just a branch, or with neither (the agent will resolve a workspace
  // default in a future iteration).
  if ((mode === "full" || mode === "execute") && !boxId) {
    return { ok: false, message: "boxId is required for mode=full|execute" };
  }
  return {
    ok: true,
    input: {
      prompt,
      mode,
      branchId,
      boxId,
      // Narrow the model hint to the allowlist at the REST boundary so a
      // leaked API key can't request a higher-tier model even if the UI's
      // Pro+ gate is bypassed. Unknown strings resolve to the default.
      model: resolveRestModel(raw.model),
      maxInputTokens: asPositiveInt(raw.maxInputTokens),
      maxOutputTokens: asPositiveInt(raw.maxOutputTokens),
    },
  };
}

export async function POST(request: NextRequest) {
  if (!isWorkspaceOperatorEnabled()) {
    return apiError(
      "operator_disabled",
      "Workspace Operator is not enabled for this deployment.",
      503
    );
  }

  const bearer = parseOperatorBearer(request.headers.get("authorization"));
  if (!bearer) {
    return E_UNAUTHORIZED("Authorization: Bearer wopr_<key> header required.");
  }

  const verified = await verifyApiKey(bearer);
  if (!verified) {
    return E_UNAUTHORIZED("Invalid or revoked API key.");
  }

  let raw: DispatchBody;
  try {
    raw = (await request.json()) as DispatchBody;
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON.");
  }

  const parsed = parseBody(raw);
  if (!parsed.ok) return E_BAD_REQUEST(parsed.message);
  const { input } = parsed;

  // Use the admin client for everything below — there is no cookie
  // session and the API key acts as the auth artifact. We still pass
  // the verified user_id / workspace_id explicitly to every write so
  // we can never accidentally write rows scoped to the wrong identity.
  const supabase = createAdminClient();

  // Per-API-key sliding-window rate limit. Runs BEFORE the monthly
  // quota check so a leaked key bursting on this endpoint can't drain
  // the workspace's monthly quota in seconds. A 429 here is distinct
  // from the quota's response: error code is `rate_limit_exceeded`
  // and a `Retry-After` header points at the burst-window recovery.
  const rateLimit = await checkApiRateLimit(supabase, verified.id);
  if (!rateLimit.allowed) {
    const retryAfter = rateLimit.retryAfterSeconds ?? 60;
    return Response.json(
      {
        error: "rate_limit_exceeded",
        retry_after_seconds: retryAfter,
        remaining_minute: rateLimit.remainingMinute,
        remaining_hour: rateLimit.remainingHour,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      },
    );
  }

  // Quota gate. The REST endpoint MUST NOT bypass it; admin email
  // bypass logic is intentionally NOT applied here because we have no
  // way to attribute "I am admin Sam acting on behalf of customer Bob"
  // safely from a bare API key.
  const quota = await checkOperatorQuota(supabase, {
    userId: verified.userId,
    workspaceId: verified.workspaceId,
  });
  if (!quota.allowed) {
    const tierLabel =
      quota.tier === "business" ? "Business" : quota.tier === "pro" ? "Pro" : "Free";
    return apiError(
      "quota_exceeded",
      `${tierLabel} tier monthly Operator quota exhausted (${quota.used}/${quota.limit ?? "\u221e"}). Resets ${quota.resetsAt.toISOString()}.`,
      429
    );
  }

  // If the caller passed a branchId, verify it belongs to the same
  // workspace before we hand it to the dispatcher. If they did not,
  // mint a fresh draft branch (mirrors the cookie-action behaviour).
  let branchId: string;
  try {
    branchId = await resolveBranch(supabase, verified, input);
  } catch (err) {
    return E_BAD_REQUEST(
      err instanceof Error ? err.message : "Failed to resolve branch."
    );
  }

  // Box validation when one was supplied — execute / full require it,
  // plan accepts it as an optional hint.
  if (input.boxId) {
    const { data: box } = await supabase
      .from("boxes")
      .select("id, workspace_id")
      .eq("id", input.boxId)
      .maybeSingle();
    if (!box || box.workspace_id !== verified.workspaceId) {
      return E_BAD_REQUEST("boxId not found in this workspace.");
    }
  }

  // Persist the run row first so we have a stable id to send to Modal
  // and to return to the caller for status polling.
  let runRow;
  try {
    runRow = await createOperatorRun(supabase, {
      workspaceId: verified.workspaceId,
      userId: verified.userId,
      branchId,
      prompt: input.prompt,
      mode: input.mode,
    });
  } catch (err) {
    return E_INTERNAL(
      err instanceof Error ? err.message : "Failed to create run row."
    );
  }

  // Plan-only mode returns immediately after the plan dispatch and
  // leaves the run in 'awaiting_approval' for the caller to inspect.
  // Full / execute modes block until the agent loop terminates.
  try {
    if (input.mode === "plan") {
      await updateOperatorRun(supabase, runRow.id, {
        status: "planning",
        branchId,
      });
      // boxId may be absent for plan-only — pass an empty string and
      // let the dispatcher's own box resolution path handle it. The
      // existing dispatchOperatorPlan accepts an empty boxId.
      await dispatchOperatorPlan({
        runId: runRow.id,
        userId: verified.userId,
        workspaceId: verified.workspaceId,
        branchId,
        boxId: input.boxId ?? "",
        prompt: input.prompt,
      });
      await updateOperatorRun(supabase, runRow.id, {
        status: "awaiting_approval",
      });
      await safeRecordUsage(supabase, verified, null);
      return apiOk(
        {
          run_id: runRow.id,
          status: "awaiting_approval",
          branch_id: branchId,
        },
        202
      );
    }

    // execute and full modes both run the same fire-once dispatcher.
    // execute is identical to full from the REST surface — the
    // distinction matters in the cookie-action flow where execute
    // operates on a previously-approved plan, but the REST surface
    // doesn't carry that state and treats them as synonyms today.
    await updateOperatorRun(supabase, runRow.id, {
      status: "executing",
      branchId,
    });

    const startedAt = Date.now();
    let result: OperatorRunResult;
    if (input.mode === "execute") {
      result = await dispatchOperatorExecute({
        runId: runRow.id,
        userId: verified.userId,
        workspaceId: verified.workspaceId,
        branchId,
        boxId: input.boxId ?? "",
        prompt: input.prompt,
        approvedPlan: [],
      });
    } else {
      result = await dispatchOperatorRun({
        runId: runRow.id,
        userId: verified.userId,
        workspaceId: verified.workspaceId,
        branchId,
        boxId: input.boxId ?? "",
        prompt: input.prompt,
      });
    }
    const durationMs = Date.now() - startedAt;

    await updateOperatorRun(supabase, runRow.id, {
      status: result.status === "completed" ? "completed" : "failed",
      result: result as unknown,
      error: result.error ?? null,
      notesCreated: result.notes_created,
      toolCalls: result.tool_calls,
      durationMs,
      inputTokens: result.input_tokens ?? 0,
      outputTokens: result.output_tokens ?? 0,
      cachedInputTokens: result.cached_input_tokens ?? 0,
      model: result.model ?? input.model ?? null,
    });
    await safeRecordUsage(supabase, verified, result);

    return apiOk(
      {
        run_id: runRow.id,
        status: result.status,
        branch_id: branchId,
        notes_created: result.notes_created,
        tool_calls: result.tool_calls,
        error: result.error ?? null,
      },
      200
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateOperatorRun(supabase, runRow.id, {
      status: "failed",
      error: message,
    }).catch(() => undefined);
    await safeRecordUsage(supabase, verified, null);
    // Log detailed error server-side (may contain Modal response body
    // fragments, auth headers echoed in error messages, internal paths).
    // Return a generic message to the API client so upstream errors do
    // not leak implementation details to third-party integrators.
    console.error("[operator REST] dispatch failed", {
      run_id: runRow.id,
      workspace_id: verified.workspaceId,
      err: message,
    });
    return E_INTERNAL("Operator dispatch failed.");
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function resolveBranch(
  supabase: ReturnType<typeof createAdminClient>,
  verified: { userId: string; workspaceId: string },
  input: DispatchInput
): Promise<string> {
  if (input.branchId) {
    const { data: branch } = await supabase
      .from("draft_branches")
      .select("id, workspace_id, status")
      .eq("id", input.branchId)
      .maybeSingle();
    if (!branch) throw new Error("branchId not found.");
    if (branch.workspace_id !== verified.workspaceId) {
      throw new Error("branchId does not belong to this workspace.");
    }
    if (branch.status !== "open") {
      throw new Error("branchId is not an open draft branch.");
    }
    return branch.id as string;
  }

  const branch = await createDraftBranch(supabase, {
    workspace_id: verified.workspaceId,
    name: `api/${Date.now().toString(36)}`,
    description: `Operator REST dispatch by api key`,
    created_by: verified.userId,
  });
  return branch.id;
}

async function safeRecordUsage(
  supabase: ReturnType<typeof createAdminClient>,
  verified: { userId: string; workspaceId: string },
  result: OperatorRunResult | null
): Promise<void> {
  try {
    await recordOperatorUsage(supabase, {
      workspaceId: verified.workspaceId,
      userId: verified.userId,
      runCount: 1,
      toolCallCount: result?.tool_calls ?? 0,
      inputTokens: result?.input_tokens ?? 0,
      outputTokens: result?.output_tokens ?? 0,
      model: result?.model,
    });
  } catch (err) {
    console.error("[operator_runs route] usage record failed", err);
  }
}
