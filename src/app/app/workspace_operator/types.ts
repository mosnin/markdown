export interface OperatorPlanStep {
  index: number;
  description: string;
  tool: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

export interface OperatorPlan {
  run_id: string;
  steps: OperatorPlanStep[];
  summary: string;
}

export type OperatorRunPhase =
  | "idle"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"
  | "quota_exceeded";

export interface OperatorProgressEvent {
  run_id: string;
  type:
    | "plan_ready"
    | "step_start"
    | "step_complete"
    | "tool_call"
    | "note_drafted"
    | "completed"
    | "failed";
  step_index?: number;
  detail?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Wave 2 — model picker / cost preview / saved prompts
// ---------------------------------------------------------------------------

/**
 * Operator model ids the panel supports.
 *
 * Mirrors the keys in `MODEL_PRICING` (workspace_operator_usage_service)
 * and the Python operator's `ALLOWED_OPERATOR_MODELS`. New entries here
 * must be reflected in both.
 */
export const OPERATOR_MODELS = [
  "gpt-4.1-mini",
  "gpt-5.4-mini",
  "o4-mini",
  "gpt-4.1",
  "o3",
] as const;
export type OperatorModel = (typeof OPERATOR_MODELS)[number];

export const DEFAULT_OPERATOR_MODEL: OperatorModel = "gpt-5.4-mini";

/**
 * UI-facing slice of a saved Operator prompt — narrowed from the
 * server-side row to just the fields the panel renders. Camel-cased
 * because it crosses the action boundary as JSON.
 */
export interface SavedOperatorPrompt {
  id: string;
  name: string;
  prompt: string;
}

/**
 * Edited plan step shape passed back through `approveAndExecuteAction`.
 * Same wire shape as `OperatorPlanStep` minus the runtime-only `status`
 * column — the agent rewrites status as it executes, so the client's
 * copy is meaningless on the way back up.
 */
export interface EditedOperatorPlanStep {
  index: number;
  description: string;
  tool: string;
}

// ---------------------------------------------------------------------------
// Cost-preview heuristic
// ---------------------------------------------------------------------------

/**
 * Per-model rates in **dollars per million tokens**, mirrored from
 * `workspace_operator_usage_service.MODEL_PRICING`. Duplicated here so the
 * panel preview doesn't pull a "use server" file across the client
 * boundary; the canonical billing math lives in the service.
 */
export const OPERATOR_MODEL_RATES: Record<
  OperatorModel,
  { inputUsdPerMillion: number; outputUsdPerMillion: number }
> = {
  "gpt-4.1-mini": { inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 },
  "gpt-5.4-mini": { inputUsdPerMillion: 0.75, outputUsdPerMillion: 4.5 },
  "o4-mini": { inputUsdPerMillion: 1.1, outputUsdPerMillion: 4.4 },
  "gpt-4.1": { inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
  "o3": { inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
};

/** Per-step output token estimate (rough — see {@link estimateOperatorRunCost}). */
export const COST_PREVIEW_OUTPUT_TOKENS_PER_STEP = 500;
/** System + workspace context overhead added to every step's input estimate. */
export const COST_PREVIEW_CONTEXT_OVERHEAD_TOKENS = 2000;

/**
 * Estimate the **maximum** USD cost of an Operator run before the user
 * approves it. The number is intentionally a worst-case upper bound:
 *
 *   - Input tokens per step ≈ prompt_length / 4 (chars-per-token rule of
 *     thumb) + 2000 token system/context overhead.
 *   - Output tokens per step ≈ 500.
 *
 * Returns dollars (not cents). Surface alongside an "Estimated max cost"
 * label and a tooltip that explains the heuristic — actual cost will
 * almost always be lower because:
 *   - cached prompt tokens are billed at ~25% of the list rate
 *   - many steps complete in fewer than 500 output tokens
 *   - retries / branches off the planned path are not counted twice
 */
export function estimateOperatorRunCost(
  promptLength: number,
  stepCount: number,
  model: OperatorModel | string | null | undefined
): number {
  const safeSteps = Math.max(0, Math.floor(stepCount));
  const safePromptLen = Math.max(0, Math.floor(promptLength));
  if (safeSteps === 0) return 0;

  const rate =
    (OPERATOR_MODEL_RATES as Record<
      string,
      { inputUsdPerMillion: number; outputUsdPerMillion: number }
    >)[model ?? DEFAULT_OPERATOR_MODEL] ??
    OPERATOR_MODEL_RATES[DEFAULT_OPERATOR_MODEL];

  const inputTokensPerStep =
    Math.ceil(safePromptLen / 4) + COST_PREVIEW_CONTEXT_OVERHEAD_TOKENS;
  const totalInputTokens = inputTokensPerStep * safeSteps;
  const totalOutputTokens =
    COST_PREVIEW_OUTPUT_TOKENS_PER_STEP * safeSteps;

  const inputUsd = (totalInputTokens / 1_000_000) * rate.inputUsdPerMillion;
  const outputUsd = (totalOutputTokens / 1_000_000) * rate.outputUsdPerMillion;
  return inputUsd + outputUsd;
}

/** Format a USD cost estimate for the panel preview line. */
export function formatOperatorCostUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
