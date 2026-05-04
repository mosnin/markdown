"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Check, ExternalLink, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PREFERRED_AI,
  readPreferredAi,
  writePreferredAi,
  type PreferredAi,
} from "@/lib/preferred_ai";
import {
  AI_LABELS,
  ALLOW_EDITS_NOTE,
  HELP_MCP_HREF,
  MCP_ESCALATION_HINT,
  PULL_TOKENS_SETTINGS_HREF,
  deepLinkForAi,
  formatBashOneLiner,
  formatPromptForAi,
  isMcpSavvy,
} from "@/lib/send_to_ai_format";
import { issuePullTokenAction } from "@/app/app/send_to_ai/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type SendToAiObjectType = "note" | "box" | "skill" | "agent" | "bundle";

export interface SendToAiPopoverProps {
  /**
   * Discriminated object descriptor. v1 only enables the popover for
   * `objectType: "note"` — other types render a disabled trigger with
   * a "Coming soon" tooltip.
   */
  objectType: SendToAiObjectType;
  /** Stable id of the underlying record. */
  objectId: string;
  /** Display name shown in the title row. Truncates with ellipsis. */
  objectName: string;
  /**
   * Optional override for the trigger label / size / variant when the
   * surface needs the trigger to feel native to its action row.
   */
  triggerLabel?: string;
  triggerSize?: "xs" | "sm" | "default";
  triggerVariant?: "outline" | "ghost" | "secondary" | "default";
  triggerClassName?: string;
  /**
   * Onboarding step (`/welcome/setup/step_3`) seeds these so the user
   * sees a sensible default the first time they meet the popover.
   */
  defaultPreferredAi?: PreferredAi;
  defaultDuration?: DurationKey;
  defaultAllowEdits?: boolean;
  /** Optional class on the popup itself (e.g. for portal-aware tests). */
  className?: string;
}

type DurationKey = "15m" | "1h" | "session" | "4h" | "custom";

interface DurationDef {
  label: string;
  ttlSeconds: number;
  slidingWindowSeconds: number;
}

const DURATIONS: Record<Exclude<DurationKey, "custom">, DurationDef> = {
  "15m": { label: "15 minutes (one-shot read)", ttlSeconds: 900, slidingWindowSeconds: 0 },
  "1h": { label: "1 hour (single task)", ttlSeconds: 3600, slidingWindowSeconds: 0 },
  session: {
    label: "Session — 30 min idle, 24h max",
    ttlSeconds: 1800,
    slidingWindowSeconds: 1800,
  },
  "4h": { label: "4 hours (long task)", ttlSeconds: 14400, slidingWindowSeconds: 0 },
};

const CUSTOM_MIN_SECONDS = 60;
const CUSTOM_MAX_SECONDS = 86400;

const AI_OPTIONS: ReadonlyArray<PreferredAi> = [
  "claude-code",
  "cursor",
  "claude-web",
  "chatgpt",
  "other",
];

// ─── Mobile detection (lightweight, SSR-safe) ────────────────────────────────

function useIsMobile(breakpointPx = 640) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [breakpointPx]);
  return isMobile;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * "Send to AI" popover.
 *
 * Issues a short-lived pull token (server action `issuePullTokenAction`)
 * and formats the prompt line for the user's chosen AI. The picker
 * preference is sticky per-user via `localStorage.poggle.preferredAi`.
 *
 * v1 only supports `objectType: "note"`. Other surfaces render the
 * trigger as a disabled affordance with a "Coming soon" tooltip via
 * the trigger's own `title` attribute (no separate Tooltip needed
 * because the trigger is non-interactive).
 *
 * On screens narrower than 640px the popover is rendered inside a
 * bottom-anchored `<Sheet>` for thumb-reach. Above that, it's a
 * standard ~360px Base UI Popover.
 */
export function SendToAiPopover(props: SendToAiPopoverProps) {
  const supported = props.objectType === "note";
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const trigger = (
    <Button
      data-icon="inline-start"
      variant={props.triggerVariant ?? "outline"}
      size={props.triggerSize ?? "sm"}
      disabled={!supported}
      title={
        supported
          ? undefined
          : "Coming soon — note bundles only in v1"
      }
      className={cn(props.triggerClassName)}
      type="button"
    >
      <Send aria-hidden="true" />
      {props.triggerLabel ?? "Send to AI"}
    </Button>
  );

  if (!supported) {
    // Disabled trigger — render in place, no popover wiring.
    return trigger;
  }

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="contents"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {trigger}
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85vh] overflow-y-auto"
          >
            <SheetHeader>
              <SheetTitle className="sr-only">Send to AI</SheetTitle>
              <SheetDescription className="sr-only">
                Generate a short-lived link to give your AI access to this {props.objectType}.
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <SendToAiBody {...props} onClose={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger render={trigger} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner sideOffset={6} align="end" className="z-50">
          <PopoverPrimitive.Popup
            className={cn(
              "w-[360px] rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg outline-none",
              "duration-150 ease-[cubic-bezier(0.2,0,0,1)] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
              props.className
            )}
          >
            <SendToAiBody {...props} onClose={() => setOpen(false)} />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// ─── Body (shared between desktop popover & mobile sheet) ────────────────────

interface BodyProps extends SendToAiPopoverProps {
  onClose: () => void;
}

function SendToAiBody({
  objectType,
  objectId,
  objectName,
  defaultPreferredAi,
  defaultDuration,
  defaultAllowEdits = false,
  onClose,
}: BodyProps) {
  const radioGroupId = useId();

  // Sticky preference — defer the read to the effect so SSR matches client.
  const [ai, setAi] = useState<PreferredAi>(
    defaultPreferredAi ?? DEFAULT_PREFERRED_AI
  );
  useEffect(() => {
    if (defaultPreferredAi) return;
    setAi(readPreferredAi());
  }, [defaultPreferredAi]);

  const handleAiChange = useCallback((next: PreferredAi) => {
    setAi(next);
    writePreferredAi(next);
  }, []);

  const [allowEdits, setAllowEdits] = useState<boolean>(defaultAllowEdits);
  const [duration, setDuration] = useState<DurationKey>(
    defaultDuration ?? (defaultAllowEdits ? "session" : "15m")
  );
  // Track whether the user has manually picked a duration — the
  // "Allow edits" toggle should only force-default to "session" when
  // the user hasn't explicitly chosen something else.
  const userPickedDurationRef = useRef(defaultDuration != null);

  useEffect(() => {
    if (userPickedDurationRef.current) return;
    setDuration(allowEdits ? "session" : "15m");
  }, [allowEdits]);

  function handleDurationChange(next: DurationKey) {
    userPickedDurationRef.current = true;
    setDuration(next);
  }

  // Custom duration state.
  const [customAmount, setCustomAmount] = useState<number>(30);
  const [customUnit, setCustomUnit] = useState<"min" | "hr">("min");
  const customSeconds = useMemo(() => {
    const raw = customUnit === "min" ? customAmount * 60 : customAmount * 3600;
    if (Number.isNaN(raw)) return CUSTOM_MIN_SECONDS;
    return Math.max(CUSTOM_MIN_SECONDS, Math.min(CUSTOM_MAX_SECONDS, raw));
  }, [customAmount, customUnit]);

  // Pull-token request state.
  const [generating, setGenerating] = useState(false);
  const [pullUrl, setPullUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showBash, setShowBash] = useState(false);

  // Reset the generated link whenever any of the inputs that affect it change.
  useEffect(() => {
    setPullUrl(null);
    setError(null);
  }, [ai, objectId, allowEdits, duration, customSeconds]);

  const promptText = useMemo(() => {
    if (!pullUrl) return "";
    return formatPromptForAi({ ai, objectType, objectId, pullUrl });
  }, [ai, objectType, objectId, pullUrl]);

  const bashLine = useMemo(
    () => (pullUrl ? formatBashOneLiner(pullUrl) : ""),
    [pullUrl]
  );

  const generate = useCallback(async (): Promise<string | null> => {
    setError(null);
    setGenerating(true);
    try {
      const ttlSeconds =
        duration === "custom"
          ? customSeconds
          : DURATIONS[duration].ttlSeconds;
      const slidingWindowSeconds =
        duration === "custom" ? 0 : DURATIONS[duration].slidingWindowSeconds;
      const result = await issuePullTokenAction({
        objectType,
        objectId,
        ttlSeconds,
        writeCapable: allowEdits,
        slidingWindowSeconds: slidingWindowSeconds || undefined,
      });
      setPullUrl(result.pullUrl);
      return formatPromptForAi({
        ai,
        objectType,
        objectId,
        pullUrl: result.pullUrl,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setError(msg);
      return null;
    } finally {
      setGenerating(false);
    }
  }, [ai, allowEdits, customSeconds, duration, objectId, objectType]);

  async function handleCopy() {
    let text = promptText;
    if (!text) {
      const next = await generate();
      if (!next) return;
      text = next;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — select the text manually and copy.");
    }
  }

  function handleOpenAi() {
    if (typeof window === "undefined") return;
    window.open(deepLinkForAi(ai), "_blank", "noopener,noreferrer");
  }

  // Cmd/Ctrl+Enter: generate + copy in one shot. Escape: close.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleCopy();
    }
  }

  const mcpSavvy = isMcpSavvy(ai);

  return (
    <div onKeyDown={handleKeyDown} className="flex flex-col gap-3">
      {/* Title row */}
      <div className="flex min-w-0 items-center gap-2">
        <h2
          className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight"
          title={objectName}
        >
          Send {objectName} to your AI
        </h2>
      </div>

      {/* AI picker */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          AI
        </span>
        <div
          role="radiogroup"
          aria-label="Choose your AI"
          className="flex flex-wrap gap-1"
        >
          {AI_OPTIONS.map((option) => {
            const active = option === ai;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleAiChange(option)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  active
                    ? "border-brand/60 bg-brand/10 text-foreground"
                    : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {AI_LABELS[option]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Duration */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Duration
        </legend>
        <div className="flex flex-col gap-1">
          {(Object.keys(DURATIONS) as Array<keyof typeof DURATIONS>).map(
            (key) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-accent"
              >
                <input
                  type="radio"
                  name={`${radioGroupId}-duration`}
                  value={key}
                  checked={duration === key}
                  onChange={() => handleDurationChange(key)}
                  className="h-3.5 w-3.5 accent-[var(--color-brand)]"
                />
                <span className="text-foreground">{DURATIONS[key].label}</span>
              </label>
            )
          )}
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-accent">
            <input
              type="radio"
              name={`${radioGroupId}-duration`}
              value="custom"
              checked={duration === "custom"}
              onChange={() => handleDurationChange("custom")}
              className="h-3.5 w-3.5 accent-[var(--color-brand)]"
            />
            <span className="text-foreground">Custom…</span>
          </label>
          {duration === "custom" && (
            <div className="ml-6 mt-1 flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={customUnit === "min" ? 1440 : 24}
                value={customAmount}
                onChange={(e) =>
                  setCustomAmount(Number(e.currentTarget.value) || 1)
                }
                className="h-8 w-20 text-xs"
                aria-label="Custom duration amount"
              />
              <select
                value={customUnit}
                onChange={(e) =>
                  setCustomUnit(e.currentTarget.value as "min" | "hr")
                }
                className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
                aria-label="Custom duration unit"
              >
                <option value="min">min</option>
                <option value="hr">hr</option>
              </select>
              <span className="text-[11px] text-muted-foreground">
                clamped 60s..24h
              </span>
            </div>
          )}
        </div>
      </fieldset>

      {/* Allow edits */}
      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
        <input
          type="checkbox"
          checked={allowEdits}
          onChange={(e) => setAllowEdits(e.currentTarget.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-brand)]"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">
            Allow the AI to suggest edits
          </span>
          {allowEdits && (
            <span className="text-[11px] text-muted-foreground">
              {ALLOW_EDITS_NOTE}
            </span>
          )}
        </span>
      </label>

      {/* Generated literal output */}
      {(pullUrl || error) && (
        <div className="flex flex-col gap-1.5">
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
              {error}
            </p>
          ) : (
            <>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Paste this into {AI_LABELS[ai]}
              </span>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-foreground">
                {promptText}
              </pre>
              {mcpSavvy && (
                <p className="text-[11px] text-muted-foreground">
                  Don&apos;t have the MCP server installed yet?{" "}
                  <a
                    href={HELP_MCP_HREF}
                    className="brand-underline font-medium text-foreground"
                  >
                    Set it up
                  </a>
                  .
                </p>
              )}
              <details
                open={showBash}
                onToggle={(e) =>
                  setShowBash((e.currentTarget as HTMLDetailsElement).open)
                }
              >
                <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                  Or copy as bash:
                </summary>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-foreground">
                  {bashLine}
                </pre>
              </details>
            </>
          )}
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-2">
        <Button
          variant="brand"
          size="sm"
          onClick={handleCopy}
          disabled={generating}
          type="button"
          data-testid="send-to-ai-copy"
        >
          {copied ? (
            <>
              <Check aria-hidden="true" />
              Copied
            </>
          ) : pullUrl ? (
            "Copy"
          ) : generating ? (
            "Generating…"
          ) : (
            "Generate & copy"
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenAi}
          type="button"
          data-icon="inline-end"
        >
          Open {AI_LABELS[ai]}
          <ExternalLink aria-hidden="true" />
        </Button>
      </div>

      {/* Footer links */}
      <div className="flex flex-col gap-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <a
          href={PULL_TOKENS_SETTINGS_HREF}
          className="brand-underline w-fit text-foreground"
        >
          Show pull-tokens →
        </a>
        {mcpSavvy && (
          <p className="italic">
            {MCP_ESCALATION_HINT}{" "}
            <a
              href={HELP_MCP_HREF}
              className="brand-underline font-medium not-italic text-foreground"
            >
              Learn how →
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
