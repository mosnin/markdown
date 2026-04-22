"use client";

import { useState, useTransition, useEffect } from "react";
import { Plus, Trash2, Zap, Clock, FileText, MousePointerClick, ToggleLeft, ToggleRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listAgentTriggersAction,
  createAgentTriggerAction,
  deleteAgentTriggerAction,
  toggleAgentTriggerAction,
  type AgentTrigger,
} from "@/app/app/agents/trigger_actions";

const TRIGGER_TYPE_META: Record<AgentTrigger["trigger_type"], { label: string; description: string; icon: React.ElementType }> = {
  note_created: { label: "Note created", description: "Runs when a new note is added to a box", icon: FileText },
  note_updated: { label: "Note updated", description: "Runs when any note in a box is saved", icon: FileText },
  schedule:     { label: "Schedule",      description: "Runs on a recurring cron schedule",      icon: Clock },
  manual:       { label: "Manual",        description: "Shows as a one-click run button in the UI", icon: MousePointerClick },
};

interface AgentTriggersPanelProps {
  agentId: string;
  boxes: Array<{ id: string; name: string }>;
  initialTriggers?: AgentTrigger[];
}

export function AgentTriggersPanel({ agentId, boxes, initialTriggers = [] }: AgentTriggersPanelProps) {
  const [triggers, setTriggers] = useState<AgentTrigger[]>(initialTriggers);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<AgentTrigger["trigger_type"]>("manual");
  const [formLabel, setFormLabel] = useState("");
  const [formBoxId, setFormBoxId] = useState<string>("");
  const [formCron, setFormCron] = useState("0 9 * * 1");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Load triggers
  useEffect(() => {
    listAgentTriggersAction(agentId).then((result) => {
      if (result.ok) setTriggers(result.data);
    });
  }, [agentId]);

  function handleCreate() {
    if (!formLabel.trim()) { setError("Label is required"); return; }
    if (formType === "schedule" && !formCron.trim()) { setError("Cron expression required"); return; }
    setError(null);
    startTransition(async () => {
      const result = await createAgentTriggerAction(agentId, {
        trigger_type: formType,
        box_id: formBoxId || null,
        cron_expression: formType === "schedule" ? formCron : null,
        label: formLabel.trim(),
      });
      if (result.ok) {
        const refreshed = await listAgentTriggersAction(agentId);
        if (refreshed.ok) setTriggers(refreshed.data);
        setShowForm(false);
        setFormLabel("");
        setFormBoxId("");
      } else {
        setError(result.error);
      }
    });
  }

  function handleDelete(triggerId: string) {
    startTransition(async () => {
      await deleteAgentTriggerAction(triggerId);
      setTriggers((prev) => prev.filter((t) => t.id !== triggerId));
    });
  }

  function handleToggle(triggerId: string, current: boolean) {
    setTriggers((prev) => prev.map((t) => t.id === triggerId ? { ...t, is_enabled: !current } : t));
    startTransition(async () => {
      await toggleAgentTriggerAction(triggerId, !current);
    });
  }

  return (
    <div className="space-y-4 px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Triggers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define when this agent runs automatically. Execution is handled by the Pog harness.
          </p>
        </div>
        <button
          onClick={() => setShowForm((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add trigger
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
          <p className="text-xs font-medium text-foreground">New trigger</p>

          {/* Trigger type */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(TRIGGER_TYPE_META) as AgentTrigger["trigger_type"][]).map((type) => {
              const meta = TRIGGER_TYPE_META[type];
              return (
                <button
                  key={type}
                  onClick={() => setFormType(type)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-md border p-2.5 text-left text-xs transition-colors",
                    formType === type
                      ? "border-violet-500/50 bg-violet-500/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent/40"
                  )}
                >
                  <meta.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="font-medium">{meta.label}</span>
                </button>
              );
            })}
          </div>

          {/* Label */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-foreground">Label</label>
            <input
              type="text"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder={`e.g. "Run on new research notes"`}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* Box filter (optional for event types) */}
          {(formType === "note_created" || formType === "note_updated") && boxes.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-foreground">Box (optional — leave blank for all boxes)</label>
              <select
                value={formBoxId}
                onChange={(e) => setFormBoxId(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">All boxes</option>
                {boxes.map((box) => (
                  <option key={box.id} value={box.id}>{box.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Cron expression */}
          {formType === "schedule" && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-foreground">Cron expression (UTC)</label>
              <input
                type="text"
                value={formCron}
                onChange={(e) => setFormCron(e.target.value)}
                placeholder="0 9 * * 1"
                className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <p className="text-[10px] text-muted-foreground">Example: <code>0 9 * * 1</code> = every Monday at 9am UTC</p>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Save trigger
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {triggers.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-center">
          <Zap className="mx-auto h-6 w-6 text-muted-foreground/40 mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No triggers configured</p>
          <p className="text-xs text-muted-foreground/70 mt-0.5">Add a trigger to automate when this agent runs.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {triggers.map((trigger) => {
            const meta = TRIGGER_TYPE_META[trigger.trigger_type];
            return (
              <div key={trigger.id} className={cn(
                "flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3",
                !trigger.is_enabled && "opacity-60"
              )}>
                <meta.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{trigger.label}</p>
                  <p className="text-xs text-muted-foreground">{meta.description}</p>
                  {trigger.cron_expression && (
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{trigger.cron_expression}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleToggle(trigger.id, trigger.is_enabled)}
                    title={trigger.is_enabled ? "Disable" : "Enable"}
                    className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {trigger.is_enabled
                      ? <ToggleRight className="h-4 w-4 text-violet-500" aria-hidden="true" />
                      : <ToggleLeft className="h-4 w-4" aria-hidden="true" />
                    }
                  </button>
                  <button
                    onClick={() => handleDelete(trigger.id)}
                    className="rounded p-1 text-muted-foreground hover:text-red-500 transition-colors"
                    aria-label="Delete trigger"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
