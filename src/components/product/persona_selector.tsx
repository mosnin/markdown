"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, AlertTriangle, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentPersonaRow {
  id: string;
  workspace_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  tool_allowlist: string[];
  model: string | null;
  max_turns: number | null;
  requires_approval: boolean;
  plan_first: boolean;
  must_cite_per_claim: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface PersonaSelectorProps {
  workspaceId: string;
  /** Current selection. `null` (or the string "default") means "use default". */
  value: string | null;
  onChange: (personaSlug: string | null) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// API shape
// ---------------------------------------------------------------------------

interface PersonasResponse {
  data?: { personas: AgentPersonaRow[] };
  error?: { message?: string } | string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(
  err: { message?: string } | string | undefined,
  fallback: string
): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  return err.message ?? fallback;
}

/** Normalise the incoming `value` — treat "default" as null. */
function normaliseValue(v: string | null): string | null {
  if (v === null || v === "default") return null;
  return v;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PersonaSelector({
  workspaceId,
  value,
  onChange,
  disabled,
}: PersonaSelectorProps) {
  const [personas, setPersonas] = useState<AgentPersonaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const selectedSlug = normaliseValue(value);

  // -- fetch ----------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/agent/personas?workspace_id=${encodeURIComponent(workspaceId)}`,
      { credentials: "same-origin" }
    )
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | PersonasResponse
          | null;
        if (cancelled) return;
        if (!res.ok || !body?.data?.personas) {
          setError(errorMessage(body?.error, `Load failed (${res.status})`));
          setPersonas([]);
        } else {
          setPersonas(body.data.personas);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load personas."
        );
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // -- derived groupings ----------------------------------------------------

  const { workspacePersonas, systemPersonas } = useMemo(() => {
    const ws: AgentPersonaRow[] = [];
    const sys: AgentPersonaRow[] = [];
    for (const p of personas) {
      if (p.workspace_id !== null) ws.push(p);
      else sys.push(p);
    }
    // Stable alphabetical order within each group.
    ws.sort((a, b) => a.name.localeCompare(b.name));
    sys.sort((a, b) => a.name.localeCompare(b.name));
    return { workspacePersonas: ws, systemPersonas: sys };
  }, [personas]);

  const selected = useMemo(
    () => personas.find((p) => p.slug === selectedSlug) ?? null,
    [personas, selectedSlug]
  );

  // -- handlers -------------------------------------------------------------

  const handleSelect = useCallback(
    (slug: string | null) => {
      onChange(slug);
      setOpen(false);
    },
    [onChange]
  );

  // -- render ---------------------------------------------------------------

  const triggerLabel = selected?.name ?? "Default";
  const triggerDescription =
    selected?.description ?? (loading ? "Loading personas..." : null);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            disabled={disabled || (loading && personas.length === 0)}
            className="h-auto min-h-9 w-full justify-between gap-2 px-3 py-1.5 text-left"
            aria-label="Select persona"
          />
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <User
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {triggerLabel}
            </span>
            {triggerDescription && (
              <span className="truncate text-[11px] text-muted-foreground">
                {triggerDescription}
              </span>
            )}
          </span>
        </span>
        {loading ? (
          <Spinner size={14} />
        ) : (
          <ChevronsUpDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-(--anchor-width) max-h-80 min-w-[280px] overflow-y-auto"
      >
        {error && (
          <div
            role="alert"
            className="m-1 flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
          >
            <AlertTriangle
              className="h-3 w-3 shrink-0"
              aria-hidden="true"
            />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {/* Default option, always first */}
        <DropdownMenuItem
          onClick={() => handleSelect(null)}
          className="items-start gap-2"
        >
          <PersonaOptionContent
            name="Default"
            description="Use the workspace default persona."
            toolCount={null}
            badges={[]}
            selected={selectedSlug === null}
          />
        </DropdownMenuItem>

        {workspacePersonas.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>This workspace</DropdownMenuLabel>
              {workspacePersonas.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => handleSelect(p.slug)}
                  className="items-start gap-2"
                >
                  <PersonaOptionContent
                    name={p.name}
                    description={p.description}
                    toolCount={p.tool_allowlist.length}
                    badges={personaBadges(p)}
                    selected={selectedSlug === p.slug}
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}

        {systemPersonas.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Built-in</DropdownMenuLabel>
              {systemPersonas.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => handleSelect(p.slug)}
                  className="items-start gap-2"
                >
                  <PersonaOptionContent
                    name={p.name}
                    description={p.description}
                    toolCount={p.tool_allowlist.length}
                    badges={personaBadges(p)}
                    selected={selectedSlug === p.slug}
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}

        {!loading && !error && personas.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No custom personas — using the default.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface PersonaBadgeSpec {
  label: string;
  title: string;
}

function personaBadges(p: AgentPersonaRow): PersonaBadgeSpec[] {
  const out: PersonaBadgeSpec[] = [];
  if (p.requires_approval) {
    out.push({ label: "approval", title: "Requires human approval per step" });
  }
  if (p.plan_first) {
    out.push({ label: "plan-first", title: "Generates a plan before execution" });
  }
  if (p.must_cite_per_claim) {
    out.push({ label: "cite", title: "Must cite every factual claim" });
  }
  return out;
}

interface PersonaOptionContentProps {
  name: string;
  description: string | null;
  toolCount: number | null;
  badges: PersonaBadgeSpec[];
  selected: boolean;
}

function PersonaOptionContent({
  name,
  description,
  toolCount,
  badges,
  selected,
}: PersonaOptionContentProps) {
  return (
    <>
      <Check
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          selected ? "text-foreground" : "text-transparent"
        )}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {name}
            </span>
            {toolCount !== null && (
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {toolCount} {toolCount === 1 ? "tool" : "tools"}
              </span>
            )}
          </span>
          {badges.length > 0 && (
            <span className="flex shrink-0 items-center gap-1">
              {badges.map((b) => (
                <Badge
                  key={b.label}
                  variant="outline"
                  className="h-4 px-1 text-[9px]"
                  title={b.title}
                >
                  {b.label}
                </Badge>
              ))}
            </span>
          )}
        </div>
        {description && (
          <span className="truncate text-[11px] text-muted-foreground">
            {description}
          </span>
        )}
      </div>
    </>
  );
}
