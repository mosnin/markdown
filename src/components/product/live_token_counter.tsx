"use client";

import { cn } from "@/lib/utils";

export interface LiveTokenCounterProps {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  model?: string | null;
  /** Optional cost-per-million-tokens hints — if provided, shows estimated cost */
  pricing?: {
    inputPerMillion: number;
    outputPerMillion: number;
    cachedInputPerMillion?: number;
  };
}

/**
 * Pick the budget-utilisation colour based on the worst of input/output
 * percent-of-budget. Returns the class for the number itself; the rest of
 * the chip stays at `text-muted-foreground` so only the problem number
 * lights up.
 */
function utilisationClass(pct: number | null): string {
  if (pct == null) return "text-foreground";
  if (pct > 0.8) return "text-destructive";
  if (pct > 0.6) return "text-amber-500";
  return "text-foreground";
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

function formatCostUsd(n: number): string {
  if (n < 0.01) return `~$${n.toFixed(4)}`;
  if (n < 1) return `~$${n.toFixed(3)}`;
  return `~$${n.toFixed(2)}`;
}

function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
  pricing: NonNullable<LiveTokenCounterProps["pricing"]>,
): number {
  // Cached-input tokens (if present) bill at their own rate and are NOT
  // double-counted against inputTokens — callers should pass the
  // non-cached portion as `inputTokens`. If no cached rate given, we
  // charge cached tokens at the standard input rate.
  const cachedRate =
    pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
  const input = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const cached = (cachedInputTokens / 1_000_000) * cachedRate;
  const output = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return input + cached + output;
}

/**
 * Compact single-line token counter designed to sit in a toolbar next to
 * a run's status. Shows `{in}↑ {out}↓` always, plus `{pct}% of budget`
 * when `maxInputTokens`/`maxOutputTokens` are set, plus `~$0.042` when
 * `pricing` is provided.
 */
export function LiveTokenCounter({
  inputTokens,
  outputTokens,
  cachedInputTokens = 0,
  maxInputTokens,
  maxOutputTokens,
  model,
  pricing,
}: LiveTokenCounterProps) {
  const totalInput = inputTokens + cachedInputTokens;

  const inputPct =
    maxInputTokens && maxInputTokens > 0
      ? totalInput / maxInputTokens
      : null;
  const outputPct =
    maxOutputTokens && maxOutputTokens > 0
      ? outputTokens / maxOutputTokens
      : null;

  // Use the worse of the two when picking the budget-chip colour.
  const worstPct =
    inputPct != null && outputPct != null
      ? Math.max(inputPct, outputPct)
      : (inputPct ?? outputPct);

  const inputColor = utilisationClass(inputPct);
  const outputColor = utilisationClass(outputPct);
  const budgetColor = utilisationClass(worstPct);

  const cost =
    pricing != null
      ? estimateCostUsd(inputTokens, outputTokens, cachedInputTokens, pricing)
      : null;

  return (
    <div
      className="inline-flex items-center gap-1 text-xs text-muted-foreground font-mono"
      role="status"
      aria-label={`Token usage: ${totalInput} input, ${outputTokens} output`}
    >
      <span
        className="inline-flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 tabular-nums"
        title={
          cachedInputTokens > 0
            ? `${inputTokens} fresh + ${cachedInputTokens} cached input tokens`
            : `${inputTokens} input tokens`
        }
      >
        <span className={cn("tabular-nums", inputColor)}>
          {formatCount(totalInput)}
        </span>
        <span aria-hidden="true">↑</span>
      </span>

      <span
        className="inline-flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 tabular-nums"
        title={`${outputTokens} output tokens`}
      >
        <span className={cn("tabular-nums", outputColor)}>
          {formatCount(outputTokens)}
        </span>
        <span aria-hidden="true">↓</span>
      </span>

      {worstPct != null && (
        <span
          className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5"
          title={
            inputPct != null && outputPct != null
              ? `Input ${Math.round(inputPct * 100)}% · Output ${Math.round(outputPct * 100)}%`
              : inputPct != null
                ? `Input ${Math.round(inputPct * 100)}% of budget`
                : `Output ${Math.round((outputPct ?? 0) * 100)}% of budget`
          }
        >
          <span aria-hidden="true" className="mr-0.5">
            ·
          </span>
          <span className={cn("tabular-nums", budgetColor)}>
            {Math.round(worstPct * 100)}%
          </span>
        </span>
      )}

      {cost != null && (
        <span
          className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5 tabular-nums"
          title={
            model
              ? `Estimated cost using ${model} pricing`
              : "Estimated cost"
          }
        >
          {formatCostUsd(cost)}
        </span>
      )}

      {model && (
        <span
          className="hidden sm:inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5 truncate max-w-[10rem]"
          title={`Model: ${model}`}
        >
          {model}
        </span>
      )}
    </div>
  );
}
