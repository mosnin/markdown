"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import {
  Bot,
  FileText,
  Globe,
  LayoutDashboard,
  Lightbulb,
  MessageCircle,
  Network,
  Plus,
  Settings,
  Sparkles,
  Tag,
  Workflow,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  listRecentNotesForPaletteAction,
  listSubagentSkillsForPaletteAction,
  searchEntitiesForPaletteAction,
  type PaletteEntity,
  type PaletteNote,
  type PaletteSubagentSkill,
} from "@/app/app/command_palette_actions";

/**
 * Cmd+K command palette (Phase 7D).
 *
 * Surfaces jump-to-anywhere navigation plus context-aware workspace data:
 * recent notes, matching entities (knowledge graph), and sub-agent skills.
 *
 * Keyboard activation lives one level up in `CommandPaletteProvider` so
 * this component only handles the palette's own UI and data loading.
 *
 * Data lifecycle:
 *   - On open → load recent notes + sub-agent skills in parallel.
 *   - On input change (200ms debounce) → refresh entities + sub-agents
 *     with the query. Empty queries clear entity results.
 *   - Static Actions / Go-to items are always rendered regardless of state.
 */

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [recentNotes, setRecentNotes] = useState<PaletteNote[]>([]);
  const [subagents, setSubagents] = useState<PaletteSubagentSkill[]>([]);
  const [entities, setEntities] = useState<PaletteEntity[]>([]);

  // Reset input whenever the palette toggles open so each summon starts
  // from a clean state without leaking the prior search.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  // Initial load — fetch the non-query-dependent data once per open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [notesRes, skillsRes] = await Promise.all([
        listRecentNotesForPaletteAction(10),
        listSubagentSkillsForPaletteAction(),
      ]);
      if (cancelled) return;
      if (notesRes.ok) setRecentNotes(notesRes.data);
      if (skillsRes.ok) setSubagents(skillsRes.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Query-dependent search, debounced. Runs for entities always and for
  // sub-agents when a query is present (so the Sub-agents group refines
  // as the user types rather than ignoring input).
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    const timer = setTimeout(async () => {
      if (!trimmed) {
        setEntities([]);
        // Refresh to unfiltered list when query clears
        const skillsRes = await listSubagentSkillsForPaletteAction();
        if (skillsRes.ok) setSubagents(skillsRes.data);
        return;
      }
      const [entityRes, skillsRes] = await Promise.all([
        searchEntitiesForPaletteAction(trimmed, 8),
        listSubagentSkillsForPaletteAction(trimmed),
      ]);
      if (entityRes.ok) setEntities(entityRes.data);
      if (skillsRes.ok) setSubagents(skillsRes.data);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);

  const navigate = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  return (
    <StyledCommandDialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
    >
      <div className="flex items-center border-b border-border px-4">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search notes, entities, agents…"
          className="flex h-11 w-full bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
        />
      </div>

      <Command.List className="max-h-[22rem] overflow-y-auto overflow-x-hidden p-1">
        <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
          No matches
        </Command.Empty>

        {/* ── Actions ────────────────────────────────────────────────── */}
        <Command.Group
          heading="Actions"
          className={GROUP_CLASS}
        >
          <PaletteItem
            value="action:new-note"
            keywords={["note", "create", "new"]}
            onSelect={() => navigate("/app/dashboard")}
            icon={Plus}
            label="New note"
            // TODO: Wire a dedicated /app/notes/new route once routing supports
            // a quick-capture entrypoint; for now we land on the dashboard.
          />
          <PaletteItem
            value="action:start-pog"
            keywords={["chat", "conversation", "pog", "assistant"]}
            onSelect={() => navigate("/app/conversation")}
            icon={Bot}
            label="Start Pog"
          />
          {hasQuery && (
            <PaletteItem
              value="action:ask-pog"
              onSelect={() =>
                navigate(
                  `/app/conversation?prompt=${encodeURIComponent(trimmedQuery)}`,
                )
              }
              icon={Sparkles}
              label={`Ask Pog: ${trimmedQuery}`}
            />
          )}
        </Command.Group>

        {/* ── Recent notes ──────────────────────────────────────────── */}
        {recentNotes.length > 0 && (
          <Command.Group heading="Recent notes" className={GROUP_CLASS}>
            {recentNotes.map((note) => (
              <PaletteItem
                key={note.id}
                value={`note:${note.id}:${note.title}`}
                keywords={[note.title]}
                onSelect={() => navigate(`/app/notes/${note.id}`)}
                icon={FileText}
                label={note.title || "Untitled"}
              />
            ))}
          </Command.Group>
        )}

        {/* ── Entities ──────────────────────────────────────────────── */}
        {entities.length > 0 && (
          <Command.Group heading="Entities" className={GROUP_CLASS}>
            {entities.map((entity) => (
              <PaletteItem
                key={entity.id}
                value={`entity:${entity.id}:${entity.name}`}
                keywords={[entity.name, entity.entity_type]}
                onSelect={() => navigate(`/app/entities/${entity.id}`)}
                icon={Tag}
                label={entity.name}
                meta={entity.entity_type}
              />
            ))}
          </Command.Group>
        )}

        {/* ── Sub-agents ────────────────────────────────────────────── */}
        {subagents.length > 0 && (
          <Command.Group heading="Sub-agents" className={GROUP_CLASS}>
            {subagents.map((skill) => (
              <PaletteItem
                key={skill.id}
                value={`subagent:${skill.id}:${skill.name}`}
                keywords={[skill.name, skill.description ?? ""]}
                onSelect={() => navigate(`/app/skills/${skill.id}`)}
                icon={Workflow}
                label={skill.name}
                meta={skill.description ?? undefined}
              />
            ))}
          </Command.Group>
        )}

        {/* ── Go to ─────────────────────────────────────────────────── */}
        <Command.Group heading="Go to" className={GROUP_CLASS}>
          <PaletteItem
            value="goto:dashboard"
            onSelect={() => navigate("/app/dashboard")}
            icon={LayoutDashboard}
            label="Dashboard"
          />
          <PaletteItem
            value="goto:graph"
            onSelect={() => navigate("/app/graph")}
            icon={Network}
            label="Graph"
          />
          <PaletteItem
            value="goto:insights"
            onSelect={() => navigate("/app/insights")}
            icon={Lightbulb}
            label="Insights"
          />
          <PaletteItem
            value="goto:web-sessions"
            onSelect={() => navigate("/app/web_sessions")}
            icon={Globe}
            label="Web sessions"
          />
          <PaletteItem
            value="goto:sub-agents"
            onSelect={() => navigate("/app/sub_agents")}
            icon={Workflow}
            label="Sub-agents"
          />
          <PaletteItem
            value="goto:conversation"
            onSelect={() => navigate("/app/conversation")}
            icon={MessageCircle}
            label="Conversation"
          />
          <PaletteItem
            value="goto:settings"
            onSelect={() => navigate("/app/settings")}
            icon={Settings}
            label="Settings"
          />
        </Command.Group>
      </Command.List>
    </StyledCommandDialog>
  );
}

// ─── Internal helpers ──────────────────────────────────────────────────────

const GROUP_CLASS =
  "overflow-hidden px-1 py-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/60";

interface PaletteItemProps {
  value: string;
  keywords?: string[];
  onSelect: () => void;
  icon: React.ElementType;
  label: string;
  meta?: string;
}

function PaletteItem({
  value,
  keywords,
  onSelect,
  icon: Icon,
  label,
  meta,
}: PaletteItemProps) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      )}
    >
      <Icon
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="flex-1 truncate">{label}</span>
      {meta && (
        <span className="ml-2 shrink-0 truncate text-[10px] capitalize text-muted-foreground/70">
          {meta}
        </span>
      )}
    </Command.Item>
  );
}

/**
 * Minimal styled wrapper around `Command.Dialog`. We avoid pulling in the
 * repo's Base UI Dialog here because cmdk's own dialog already handles
 * the portal, overlay, focus trap, and escape-to-close.
 */
function StyledCommandDialog({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  // Close on escape is handled internally by cmdk. We only need to style
  // the dialog container and backdrop.
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={label}
      overlayClassName="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      contentClassName="fixed left-1/2 top-[20%] z-50 w-[92vw] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none"
    >
      <div ref={contentRef} className="flex flex-col">
        {children}
      </div>
    </Command.Dialog>
  );
}
