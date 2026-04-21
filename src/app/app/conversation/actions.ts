"use server";

import { after } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { isWorkspaceOperatorEnabled } from "@/lib/env";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
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
import { recordOperatorUsage } from "@/server/services/workspace_operator_usage_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import { safeNotify } from "@/app/app/workspace_operator/actions";
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

  let result: OperatorRunResult;
  try {
    result = await dispatchOperatorRun({
      runId: input.runId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      branchId: input.branchId,
      boxId: input.boxId,
      prompt: input.prompt,
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
        error: "Pog Agent is not enabled for this deployment.",
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

    const supabase = await createClient();

    // 4. Resolve box id (or pick the workspace's first available box).
    let boxId = input.boxId?.trim() || null;
    if (!boxId) {
      const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);
      if (boxes.length === 0) {
        return {
          ok: false,
          error:
            "Create your first box before starting a conversation — Pog drafts notes into a box.",
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
