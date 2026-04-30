"use client";

import { useState, useTransition } from "react";
import { Loader2, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/product/toast_provider";
import { updateSubagentConfigAction } from "@/app/app/skills/subagent_actions";

// Default tool catalogue that matches the Atlas AI orchestrator's runtime
// tool registry. Kept here (rather than fetched) so the panel can
// render synchronously from server-supplied props without a round-
// trip. Callers may override via `availableTools` when a workspace
// has a custom tool set.
const DEFAULT_AVAILABLE_TOOLS: Array<{ name: string; description?: string }> = [
  { name: "search" },
  { name: "read_note" },
  { name: "draft_note" },
  { name: "edit_note" },
  { name: "rename_note" },
  { name: "archive_note" },
  { name: "move_note" },
  { name: "link_notes" },
  { name: "list_notes_in_box" },
  { name: "apply_template" },
  { name: "propose_box_structure" },
  { name: "execute_code" },
  { name: "web_search" },
  { name: "web_fetch" },
  { name: "deep_search" },
  { name: "browse_session_start" },
  { name: "browse_session_step" },
  { name: "browse_session_end" },
];

interface SkillSubagentPanelProps {
  skillId: string;
  initialIsSubagent: boolean;
  initialTools: string[] | null; // null = all tools allowed
  initialMaxTurns: number | null; // null = system default
  availableTools?: Array<{ name: string; description?: string }> | null;
}

export function SkillSubagentPanel({
  skillId,
  initialIsSubagent,
  initialTools,
  initialMaxTurns,
  availableTools,
}: SkillSubagentPanelProps) {
  const tools = availableTools && availableTools.length > 0
    ? availableTools
    : DEFAULT_AVAILABLE_TOOLS;

  const [isSubagent, setIsSubagent] = useState(initialIsSubagent);
  const [useAllTools, setUseAllTools] = useState(initialTools === null);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(
    new Set(initialTools ?? [])
  );
  const [maxTurns, setMaxTurns] = useState<number | null>(initialMaxTurns);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  const fieldsDisabled = !isSubagent;

  function toggleTool(name: string) {
    if (fieldsDisabled || useAllTools) return;
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleSave() {
    setSaving(true);
    startTransition(async () => {
      const payload = {
        is_subagent: isSubagent,
        subagent_tools: useAllTools ? null : Array.from(selectedTools).sort(),
        subagent_max_turns: maxTurns,
      };
      const result = await updateSubagentConfigAction(skillId, payload);
      setSaving(false);
      if (result.ok) {
        toast("Sub-agent settings saved", "success");
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">Sub-agent</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Turn this skill into a sub-agent that Atlas AI can call via
            invoke_subagent. Sub-agents run in a fresh context window to
            prevent context rot.
          </p>
        </div>
      </div>

      {/* Enable toggle */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isSubagent}
          onChange={(e) => setIsSubagent(e.target.checked)}
          className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-500"
        />
        <span className="text-sm font-medium text-foreground">
          Enable this skill as a sub-agent
        </span>
      </label>

      {/* Tool whitelist */}
      <div className={cn("space-y-2", fieldsDisabled && "opacity-50 pointer-events-none")}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-foreground">Tool whitelist</p>
            <p className="text-[11px] text-muted-foreground">
              Tools this sub-agent is allowed to call.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useAllTools}
              disabled={fieldsDisabled}
              onChange={(e) => setUseAllTools(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border text-brand-600 focus:ring-brand-500"
            />
            Use all tools
          </label>
        </div>

        <div
          className={cn(
            "grid grid-cols-2 gap-1.5 rounded-md border border-border bg-muted/20 p-2.5 sm:grid-cols-3",
            useAllTools && "opacity-50"
          )}
        >
          {tools.map((t) => {
            const checked = useAllTools || selectedTools.has(t.name);
            return (
              <label
                key={t.name}
                className={cn(
                  "flex items-center gap-2 rounded px-1.5 py-1 text-xs text-foreground",
                  !useAllTools && !fieldsDisabled && "cursor-pointer hover:bg-accent/40"
                )}
                title={t.description ?? undefined}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={useAllTools || fieldsDisabled}
                  onChange={() => toggleTool(t.name)}
                  className="h-3.5 w-3.5 rounded border-border text-brand-600 focus:ring-brand-500"
                />
                <span className="truncate font-mono text-[11px]">{t.name}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Max turns */}
      <div className={cn("space-y-1", fieldsDisabled && "opacity-50 pointer-events-none")}>
        <label className="text-xs font-medium text-foreground" htmlFor={`subagent-max-turns-${skillId}`}>
          Max turns
        </label>
        <input
          id={`subagent-max-turns-${skillId}`}
          type="number"
          min={1}
          max={100}
          disabled={fieldsDisabled}
          value={maxTurns ?? ""}
          placeholder="20"
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              setMaxTurns(null);
              return;
            }
            const parsed = Number.parseInt(raw, 10);
            if (Number.isFinite(parsed)) setMaxTurns(parsed);
          }}
          className="w-28 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed"
        />
        <p className="text-[11px] text-muted-foreground">
          Hard cap on agent-loop iterations. Leave empty to use the system default (20). Allowed range 1-100.
        </p>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          {saving ? "Saving…" : "Save sub-agent settings"}
        </button>
      </div>
    </section>
  );
}
