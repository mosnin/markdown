"use client";

import { useState, useTransition, useEffect } from "react";
import { Bot, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getAttachablesToBoxAction,
  attachSkillToBoxAction,
  attachAgentToBoxAction,
} from "@/app/app/boxes/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type AttachableSkill = {
  id: string;
  name: string;
  description: string | null;
  canonical_format: string;
  status: string;
};

type AttachableAgent = {
  id: string;
  name: string;
  description: string | null;
  canonical_format: string;
  agent_type: string | null;
  status: string;
};

// ─── Selectable item ──────────────────────────────────────────────────────────

function SelectableItem({
  icon,
  name,
  description,
  badge,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  name: string;
  description: string | null;
  badge: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-start gap-3 rounded-lg border p-3 text-left text-sm transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-ring bg-accent text-foreground"
          : "border-border bg-card text-foreground hover:bg-accent/40"
      )}
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{name}</span>
          <span className="ml-auto shrink-0 rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {badge}
          </span>
        </div>
        {description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </button>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AttachReusableDialogProps {
  boxId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttached?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AttachReusableDialog({
  boxId,
  open,
  onOpenChange,
  onAttached,
}: AttachReusableDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<"skills" | "agents">("skills");
  const [skills, setSkills] = useState<AttachableSkill[]>([]);
  const [agents, setAgents] = useState<AttachableAgent[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load attachable objects whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelectedSkillId(null);
    setSelectedAgentId(null);
    setLoading(true);
    getAttachablesToBoxAction(boxId)
      .then((result) => {
        if (result.ok) {
          setSkills(result.data.skills);
          setAgents(result.data.agents);
        } else {
          setError(result.error);
        }
      })
      .catch(() => setError("Failed to load attachable objects"))
      .finally(() => setLoading(false));
  }, [open, boxId]);

  function handleAttach() {
    setError(null);
    startTransition(async () => {
      let result;
      if (tab === "skills" && selectedSkillId) {
        result = await attachSkillToBoxAction(boxId, selectedSkillId);
      } else if (tab === "agents" && selectedAgentId) {
        result = await attachAgentToBoxAction(boxId, selectedAgentId);
      } else {
        return;
      }

      if (result.ok) {
        onOpenChange(false);
        onAttached?.();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const canAttach =
    (tab === "skills" && selectedSkillId !== null) ||
    (tab === "agents" && selectedAgentId !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach reusable to box</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-1">
          Attach a workspace-level skill or agent by reference. Edits to the source
          are reflected here automatically.
        </p>

        {/* Tab switcher */}
        <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
          <button
            type="button"
            onClick={() => setTab("skills")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === "skills"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            Skills
          </button>
          <button
            type="button"
            onClick={() => setTab("agents")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === "agents"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Bot className="h-3.5 w-3.5" aria-hidden="true" />
            Agents
          </button>
        </div>

        {/* List */}
        <div className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/10">
          {loading ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Loading…</p>
          ) : tab === "skills" ? (
            skills.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No unattached reusable skills in this workspace.
              </p>
            ) : (
              <div className="flex flex-col gap-1 p-2">
                {skills.map((skill) => (
                  <SelectableItem
                    key={skill.id}
                    icon={<Zap className="h-4 w-4" />}
                    name={skill.name}
                    description={skill.description}
                    badge={skill.canonical_format}
                    selected={selectedSkillId === skill.id}
                    onSelect={() =>
                      setSelectedSkillId((prev) => (prev === skill.id ? null : skill.id))
                    }
                  />
                ))}
              </div>
            )
          ) : agents.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No unattached reusable agents in this workspace.
            </p>
          ) : (
            <div className="flex flex-col gap-1 p-2">
              {agents.map((agent) => (
                <SelectableItem
                  key={agent.id}
                  icon={<Bot className="h-4 w-4" />}
                  name={agent.name}
                  description={agent.description}
                  badge={agent.canonical_format}
                  selected={selectedAgentId === agent.id}
                  onSelect={() =>
                    setSelectedAgentId((prev) => (prev === agent.id ? null : agent.id))
                  }
                />
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canAttach || isPending}
            onClick={handleAttach}
          >
            {isPending ? "Attaching…" : "Attach"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
