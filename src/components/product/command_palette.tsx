"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Building2,
  CreditCard,
  Download,
  FileText,
  Globe,
  HelpCircle,
  Key,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  Link as LinkIcon,
  LogOut,
  MessageCircle,
  Network,
  Play,
  Plug,
  Plus,
  RotateCw,
  Scale,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SunMoon,
  Tag,
  Users,
  Webhook,
  Workflow,
} from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";
import {
  listAgentsForPaletteAction,
  listBoxesForPaletteAction,
  listBranchesForPaletteAction,
  listRecentNotesForPaletteAction,
  listSubagentSkillsForPaletteAction,
  listWorkspacesForPaletteAction,
  searchEntitiesForPaletteAction,
  searchNotesForPaletteAction,
  type PaletteAgent,
  type PaletteBox,
  type PaletteBranch,
  type PaletteEntity,
  type PaletteNote,
  type PaletteSubagentSkill,
  type PaletteWorkspace,
} from "@/app/app/command_palette_actions";
import { signOut } from "@/app/app/actions";
import { setActiveWorkspaceAction } from "@/app/app/workspaces/actions";
import { OPEN_OPERATOR_EVENT } from "@/components/product/operator/operator_panel_trigger";

/**
 * Cmd+K command palette.
 *
 * Surfaces every primary action in the app — typeahead pickers, navigation,
 * settings deep links, theme toggle, and sign-out — alongside context-aware
 * data (recent notes, matching entities, sub-agents).
 *
 * Keyboard activation lives one level up in `CommandPaletteProvider` so
 * this component only handles the palette's own UI and data loading.
 *
 * Data lifecycle:
 *   - On open → load recent notes, boxes, agents, branches, sub-agents,
 *     workspaces in parallel (one round trip per source, all read-only).
 *   - On input change (200ms debounce) → refresh search-driven sources
 *     (entities, note-search, agents, sub-agents, branches) with the
 *     query.
 *   - Static commands always render regardless of state — typeahead
 *     filtering is delegated to cmdk's matcher.
 */

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional pre-populated query when the palette is summoned via event. */
  initialQuery?: string;
}

/** Mode lets external triggers seed the palette in a focused sub-flow. */
type PaletteMode = "default" | "open-box" | "open-note" | "run-agent";

export function CommandPalette({
  open,
  onOpenChange,
  initialQuery,
}: CommandPaletteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<PaletteMode>("default");
  const [recentNotes, setRecentNotes] = useState<PaletteNote[]>([]);
  const [searchedNotes, setSearchedNotes] = useState<PaletteNote[]>([]);
  const [boxes, setBoxes] = useState<PaletteBox[]>([]);
  const [agents, setAgents] = useState<PaletteAgent[]>([]);
  const [subagents, setSubagents] = useState<PaletteSubagentSkill[]>([]);
  const [branches, setBranches] = useState<PaletteBranch[]>([]);
  const [workspaces, setWorkspaces] = useState<PaletteWorkspace[]>([]);
  const [entities, setEntities] = useState<PaletteEntity[]>([]);

  // Reset transient state whenever the palette toggles open so each
  // summon starts clean. We use the derived-state-during-render pattern
  // so the reset is synchronous and doesn't trigger a cascading re-render
  // from an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery(initialQuery ?? "");
      setMode("default");
    }
  }

  // Initial load — fetch the non-query-dependent data once per open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [notesRes, boxesRes, agentsRes, branchesRes, skillsRes, wsRes] =
        await Promise.all([
          listRecentNotesForPaletteAction(10),
          listBoxesForPaletteAction(),
          listAgentsForPaletteAction(),
          listBranchesForPaletteAction(),
          listSubagentSkillsForPaletteAction(),
          listWorkspacesForPaletteAction(),
        ]);
      if (cancelled) return;
      if (notesRes.ok) setRecentNotes(notesRes.data);
      if (boxesRes.ok) setBoxes(boxesRes.data);
      if (agentsRes.ok) setAgents(agentsRes.data);
      if (branchesRes.ok) setBranches(branchesRes.data);
      if (skillsRes.ok) setSubagents(skillsRes.data);
      if (wsRes.ok) setWorkspaces(wsRes.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Query-dependent search, debounced. Runs entity search and note search
  // unconditionally and refines agents / sub-agents / branches when a
  // query is present.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    const timer = setTimeout(async () => {
      if (!trimmed) {
        setEntities([]);
        setSearchedNotes([]);
        // Refresh to unfiltered lists when the query clears.
        const [agentsRes, branchesRes, skillsRes] = await Promise.all([
          listAgentsForPaletteAction(),
          listBranchesForPaletteAction(),
          listSubagentSkillsForPaletteAction(),
        ]);
        if (agentsRes.ok) setAgents(agentsRes.data);
        if (branchesRes.ok) setBranches(branchesRes.data);
        if (skillsRes.ok) setSubagents(skillsRes.data);
        return;
      }
      const [entityRes, notesRes, agentsRes, branchesRes, skillsRes] =
        await Promise.all([
          searchEntitiesForPaletteAction(trimmed, 8),
          searchNotesForPaletteAction(trimmed, 10),
          listAgentsForPaletteAction(trimmed),
          listBranchesForPaletteAction(trimmed),
          listSubagentSkillsForPaletteAction(trimmed),
        ]);
      if (entityRes.ok) setEntities(entityRes.data);
      if (notesRes.ok) setSearchedNotes(notesRes.data);
      if (agentsRes.ok) setAgents(agentsRes.data);
      if (branchesRes.ok) setBranches(branchesRes.data);
      if (skillsRes.ok) setSubagents(skillsRes.data);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const navigate = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const openOperator = useCallback(() => {
    close();
    // Defer to the next tick so the palette unmount completes before the
    // operator panel mounts — avoids focus-trap fights.
    setTimeout(() => {
      window.dispatchEvent(new Event(OPEN_OPERATOR_EVENT));
    }, 0);
  }, [close]);

  // Derive the active note id from the URL so "Bundle for AI" can target
  // the current note without prop-drilling.
  const currentNoteId = useMemo(() => {
    if (!pathname) return null;
    const match = pathname.match(/^\/app\/notes\/([^/?#]+)/);
    return match?.[1] ?? null;
  }, [pathname]);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const inOpenBoxMode = mode === "open-box";
  const inOpenNoteMode = mode === "open-note";
  const inRunAgentMode = mode === "run-agent";
  const inAnyPickerMode = inOpenBoxMode || inOpenNoteMode || inRunAgentMode;

  async function handleSwitchWorkspace(id: string) {
    close();
    const res = await setActiveWorkspaceAction(id);
    if (res.ok) {
      router.push("/app");
      router.refresh();
    }
  }

  async function handleSignOut() {
    close();
    await signOut();
  }

  function handleToggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
    close();
  }

  return (
    <StyledCommandDialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
    >
      <div className="flex items-center gap-2 border-b border-border px-4">
        {inAnyPickerMode && (
          <button
            type="button"
            onClick={() => setMode("default")}
            className="-ml-1 inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-muted px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Back to all commands"
          >
            ← Back
          </button>
        )}
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={
            inOpenBoxMode
              ? "Open box…"
              : inOpenNoteMode
              ? "Open note…"
              : inRunAgentMode
              ? "Run agent on…"
              : "Search or run a command…"
          }
          className="flex h-11 w-full bg-transparent py-3 text-[14px] text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        <kbd className="hidden h-5 shrink-0 items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
          Esc
        </kbd>
      </div>

      <Command.List className="max-h-[26rem] overflow-y-auto overflow-x-hidden p-1.5">
        <Command.Empty className="py-8 text-center text-[13px] text-muted-foreground">
          No matches.{" "}
          <span className="text-muted-foreground/70">
            Try ⌘⇧K or ⌘. mid-edit.
          </span>
        </Command.Empty>

        {/* ── Picker sub-modes — render only the relevant typeahead ────── */}
        {inOpenBoxMode && (
          <Command.Group heading="Boxes" className={GROUP_CLASS}>
            {boxes
              .filter((b) =>
                hasQuery
                  ? b.name.toLowerCase().includes(trimmedQuery.toLowerCase())
                  : true,
              )
              .map((box) => (
                <PaletteItem
                  key={box.id}
                  value={`open-box:${box.id}:${box.name}`}
                  keywords={[box.name, box.slug]}
                  onSelect={() => navigate(`/app/boxes/${box.id}`)}
                  icon={Boxes}
                  label={box.name}
                />
              ))}
            {boxes.length === 0 && (
              <PaletteItem
                value="open-box:create"
                onSelect={() => navigate("/app")}
                icon={Plus}
                label="Create your first box"
              />
            )}
          </Command.Group>
        )}

        {inOpenNoteMode && (
          <>
            {(hasQuery ? searchedNotes : recentNotes).length > 0 && (
              <Command.Group
                heading={hasQuery ? "Notes" : "Recent notes"}
                className={GROUP_CLASS}
              >
                {(hasQuery ? searchedNotes : recentNotes).map((note) => (
                  <PaletteItem
                    key={note.id}
                    value={`open-note:${note.id}:${note.title}`}
                    keywords={[note.title]}
                    onSelect={() => navigate(`/app/notes/${note.id}`)}
                    icon={FileText}
                    label={note.title || "Untitled"}
                  />
                ))}
              </Command.Group>
            )}
          </>
        )}

        {inRunAgentMode && (
          <Command.Group heading="Agents" className={GROUP_CLASS}>
            {agents.map((agent) => (
              <PaletteItem
                key={agent.id}
                value={`run-agent:${agent.id}:${agent.name}`}
                keywords={[agent.name, agent.description ?? ""]}
                onSelect={() => {
                  // The operator panel reads its target from the
                  // OPEN_OPERATOR_EVENT listener; landing on the agent
                  // page is the predictable fallback that scopes the
                  // operator to that agent's editor.
                  navigate(`/app/agents/${agent.id}`);
                  setTimeout(() => {
                    window.dispatchEvent(new Event(OPEN_OPERATOR_EVENT));
                  }, 0);
                }}
                icon={Bot}
                label={agent.name}
                meta={agent.description ?? undefined}
              />
            ))}
            {agents.length === 0 && (
              <PaletteItem
                value="run-agent:browse"
                onSelect={() => navigate("/app/agents")}
                icon={Bot}
                label="Browse agents"
              />
            )}
          </Command.Group>
        )}

        {/* ── Default surface ──────────────────────────────────────────── */}
        {!inAnyPickerMode && (
          <>
            {/* Actions ─────────────────────────────────────────────────── */}
            <Command.Group heading="Actions" className={GROUP_CLASS}>
              <PaletteItem
                value="action:new-note"
                keywords={["note", "create", "new"]}
                onSelect={() => navigate("/app/dashboard")}
                icon={Plus}
                label="New note"
                shortcut="N"
              />
              <PaletteItem
                value="action:new-box"
                keywords={["box", "collection", "create"]}
                onSelect={() => navigate("/app/dashboard")}
                icon={Boxes}
                label="New box"
                meta="or create your first collection"
              />
              <PaletteItem
                value="action:open-box"
                keywords={["box", "open", "switch", "jump"]}
                onSelect={() => {
                  setMode("open-box");
                  setQuery("");
                }}
                icon={Boxes}
                label="Open box…"
              />
              <PaletteItem
                value="action:open-note"
                keywords={["note", "open", "jump"]}
                onSelect={() => {
                  setMode("open-note");
                  setQuery("");
                }}
                icon={FileText}
                label="Open note…"
              />
              {currentNoteId ? (
                <PaletteItem
                  value="action:bundle-current-note"
                  keywords={["bundle", "ai", "context", "export"]}
                  onSelect={() => navigate(`/app/notes/${currentNoteId}#bundle`)}
                  icon={Download}
                  label="Bundle for AI"
                  meta="current note"
                />
              ) : (
                <PaletteItem
                  value="action:bundle-pick-note"
                  keywords={["bundle", "ai", "context", "export"]}
                  onSelect={() => {
                    setMode("open-note");
                    setQuery("");
                  }}
                  icon={Download}
                  label="Bundle for AI…"
                  meta="pick a note"
                />
              )}
              <PaletteItem
                value="action:run-agent"
                keywords={["agent", "run", "operator", "execute"]}
                onSelect={() => {
                  setMode("run-agent");
                  setQuery("");
                }}
                icon={Bot}
                label="Run agent on…"
              />
              <PaletteItem
                value="action:promote-branch"
                keywords={["branch", "promote", "merge", "main"]}
                onSelect={() => navigate("/app/branches")}
                icon={RotateCw}
                label="Promote branch"
                meta={branches[0]?.name}
              />
              <PaletteItem
                value="action:start-pog"
                keywords={["chat", "conversation", "atlas", "assistant", "ai"]}
                onSelect={openOperator}
                icon={Sparkles}
                label="Start Atlas AI"
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
                  label={`Ask Atlas AI: ${trimmedQuery}`}
                />
              )}
            </Command.Group>

            {/* Recent notes ─────────────────────────────────────────────── */}
            {(hasQuery ? searchedNotes : recentNotes).length > 0 && (
              <Command.Group
                heading={hasQuery ? "Notes" : "Recent"}
                className={GROUP_CLASS}
              >
                {(hasQuery ? searchedNotes : recentNotes).map((note) => (
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

            {/* Boxes ───────────────────────────────────────────────────── */}
            {boxes.length > 0 && (
              <Command.Group heading="Boxes" className={GROUP_CLASS}>
                {boxes.slice(0, 8).map((box) => (
                  <PaletteItem
                    key={box.id}
                    value={`box:${box.id}:${box.name}`}
                    keywords={[box.name, box.slug]}
                    onSelect={() => navigate(`/app/boxes/${box.id}`)}
                    icon={Boxes}
                    label={box.name}
                  />
                ))}
              </Command.Group>
            )}

            {/* Agents ──────────────────────────────────────────────────── */}
            {agents.length > 0 && (
              <Command.Group heading="Agents" className={GROUP_CLASS}>
                {agents.slice(0, 6).map((agent) => (
                  <PaletteItem
                    key={agent.id}
                    value={`agent:${agent.id}:${agent.name}`}
                    keywords={[agent.name, agent.description ?? ""]}
                    onSelect={() => navigate(`/app/agents/${agent.id}`)}
                    icon={Bot}
                    label={agent.name}
                    meta={agent.description ?? undefined}
                  />
                ))}
              </Command.Group>
            )}

            {/* Skills (sub-agents) ─────────────────────────────────────── */}
            {subagents.length > 0 && (
              <Command.Group heading="Skills" className={GROUP_CLASS}>
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

            {/* Branches ────────────────────────────────────────────────── */}
            {branches.length > 0 && (
              <Command.Group heading="Branches" className={GROUP_CLASS}>
                {branches.slice(0, 6).map((branch) => (
                  <PaletteItem
                    key={branch.id}
                    value={`branch:${branch.id}:${branch.name}`}
                    keywords={[branch.name]}
                    onSelect={() => navigate(`/app/branches/${branch.id}`)}
                    icon={RotateCw}
                    label={branch.name}
                    meta={branch.status}
                  />
                ))}
              </Command.Group>
            )}

            {/* Entities ────────────────────────────────────────────────── */}
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

            {/* Settings ────────────────────────────────────────────────── */}
            <Command.Group heading="Settings" className={GROUP_CLASS}>
              <PaletteItem
                value="settings:root"
                keywords={["preferences", "options"]}
                onSelect={() => navigate("/app/settings")}
                icon={Settings}
                label="Settings"
              />
              <PaletteItem
                value="settings:profile"
                keywords={["profile", "account", "name", "avatar"]}
                onSelect={() => navigate("/app/settings#settings-profile")}
                icon={Users}
                label="Settings → Profile"
              />
              <PaletteItem
                value="settings:workspace"
                keywords={["workspace", "name", "slug"]}
                onSelect={() => navigate("/app/settings#settings-workspace")}
                icon={Building2}
                label="Settings → Workspace"
              />
              <PaletteItem
                value="settings:billing"
                keywords={["billing", "plan", "subscription", "invoice"]}
                onSelect={() => navigate("/app/settings#settings-billing")}
                icon={CreditCard}
                label="Settings → Billing"
              />
              <PaletteItem
                value="settings:notifications"
                keywords={["notifications", "email", "alerts"]}
                onSelect={() =>
                  navigate("/app/settings/notifications")
                }
                icon={Bell}
                label="Settings → Notifications"
              />
              <PaletteItem
                value="settings:security"
                keywords={["security", "passkeys", "2fa", "password"]}
                onSelect={() => navigate("/app/settings#settings-security")}
                icon={ShieldCheck}
                label="Settings → Security"
              />
              <PaletteItem
                value="settings:members"
                keywords={["members", "team", "people", "invites"]}
                onSelect={() =>
                  navigate("/app/settings/workspace/members")
                }
                icon={Users}
                label="Settings → Members"
              />
              <PaletteItem
                value="settings:branch-retention"
                keywords={["branch", "retention", "auto-discard", "cleanup"]}
                onSelect={() =>
                  navigate("/app/settings/workspace/branch_retention")
                }
                icon={RotateCw}
                label="Settings → Branch retention"
              />
              <PaletteItem
                value="settings:webhooks"
                keywords={["webhooks", "events", "integrations"]}
                onSelect={() =>
                  navigate("/app/settings/workspace/webhooks")
                }
                icon={Webhook}
                label="Settings → Webhooks"
              />
              <PaletteItem
                value="settings:oauth-clients"
                keywords={["oauth", "clients", "developer", "apps"]}
                onSelect={() =>
                  navigate("/app/settings/oauth_clients")
                }
                icon={Key}
                label="Settings → OAuth clients"
              />
              <PaletteItem
                value="settings:connected-apps"
                keywords={["connected", "apps", "integrations", "third-party"]}
                onSelect={() => navigate("/app/settings/connected_apps")}
                icon={Plug}
                label="Settings → Connected apps"
              />
              <PaletteItem
                value="settings:sso"
                keywords={["sso", "saml", "single sign-on", "identity"]}
                onSelect={() =>
                  navigate("/app/settings/workspace/sso")
                }
                icon={ShieldCheck}
                label="Settings → SSO"
              />
              {workspaces.length > 1 && (
                <PaletteItem
                  value="settings:switch-workspace"
                  keywords={["switch", "workspace", "tenant"]}
                  onSelect={() => navigate("/app/workspaces")}
                  icon={Building2}
                  label="Switch workspace…"
                  meta={`${workspaces.length} workspaces`}
                />
              )}
              {workspaces.slice(0, 6).map((ws) => (
                <PaletteItem
                  key={ws.id}
                  value={`workspace:${ws.id}:${ws.name}`}
                  keywords={["switch", "workspace", ws.name, ws.slug]}
                  onSelect={() => handleSwitchWorkspace(ws.id)}
                  icon={Building2}
                  label={`Switch to ${ws.name}`}
                  meta={ws.slug}
                />
              ))}
              <PaletteItem
                value="action:toggle-theme"
                keywords={["theme", "dark", "light", "appearance"]}
                onSelect={handleToggleTheme}
                icon={SunMoon}
                label="Toggle theme"
                meta={theme === "dark" ? "dark → light" : "light → dark"}
              />
              <PaletteItem
                value="action:sign-out"
                keywords={["sign out", "log out", "logout", "leave"]}
                onSelect={handleSignOut}
                icon={LogOut}
                label="Sign out"
              />
            </Command.Group>

            {/* Go to ───────────────────────────────────────────────────── */}
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
                label="Open insights"
              />
              <PaletteItem
                value="goto:analytics"
                onSelect={() => navigate("/app/analytics")}
                icon={BarChart3}
                label="Open analytics"
              />
              <PaletteItem
                value="goto:activity"
                onSelect={() => navigate("/app/activity")}
                icon={Activity}
                label="Open activity feed"
              />
              <PaletteItem
                value="goto:audit"
                onSelect={() => navigate("/app/audit")}
                icon={ScrollText}
                label="Open audit log"
              />
              <PaletteItem
                value="goto:trust"
                onSelect={() => navigate("/trust")}
                icon={Scale}
                label="Open trust & security"
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
                value="goto:workflows"
                onSelect={() => navigate("/app/workflows")}
                icon={Play}
                label="Workflows"
              />
              <PaletteItem
                value="goto:operator"
                onSelect={() => navigate("/app/workspace_operator")}
                icon={Sparkles}
                label="Workspace operator"
              />
              <PaletteItem
                value="goto:branches"
                onSelect={() => navigate("/app/branches")}
                icon={RotateCw}
                label="Draft branches"
              />
              <PaletteItem
                value="goto:proposals"
                onSelect={() => navigate("/app/proposals")}
                icon={FileText}
                label="Write proposals"
              />
              <PaletteItem
                value="goto:search"
                onSelect={() => navigate("/app/search")}
                icon={Search}
                label="Search"
              />
              <PaletteItem
                value="goto:conversation"
                onSelect={() => navigate("/app/conversation")}
                icon={MessageCircle}
                label="Conversation"
              />
            </Command.Group>

            {/* Help & docs ─────────────────────────────────────────────── */}
            <Command.Group heading="Help" className={GROUP_CLASS}>
              <PaletteItem
                value="help:api-docs"
                keywords={["api", "docs", "reference"]}
                onSelect={() => navigate("/api")}
                icon={LinkIcon}
                label="Open API docs"
              />
              <PaletteItem
                value="help:mcp-docs"
                keywords={["mcp", "model context protocol", "docs"]}
                onSelect={() => navigate("/.well-known/mcp-server")}
                icon={LinkIcon}
                label="Open MCP docs"
              />
              <PaletteItem
                value="help:help"
                keywords={["help", "docs", "guide"]}
                onSelect={() => navigate("/help")}
                icon={HelpCircle}
                label="Help"
              />
              <PaletteItem
                value="help:support"
                keywords={["support", "contact", "feedback"]}
                onSelect={() =>
                  window.open("mailto:support@contextstore.app", "_blank")
                }
                icon={LifeBuoy}
                label="Contact support"
              />
            </Command.Group>
          </>
        )}
      </Command.List>

      <PaletteFooter />
    </StyledCommandDialog>
  );
}

// ─── Internal helpers ──────────────────────────────────────────────────────

const GROUP_CLASS =
  "overflow-hidden px-1 py-1 text-foreground [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-overline [&_[cmdk-group-heading]]:text-muted-foreground/70";

interface PaletteItemProps {
  value: string;
  keywords?: string[];
  onSelect: () => void;
  icon: React.ElementType;
  label: string;
  meta?: string;
  shortcut?: string;
}

function PaletteItem({
  value,
  keywords,
  onSelect,
  icon: Icon,
  label,
  meta,
  shortcut,
}: PaletteItemProps) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] outline-none transition-colors duration-150",
        "data-[selected=true]:bg-accent data-[selected=true]:text-foreground data-[selected=true]:font-medium",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      )}
    >
      <Icon
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="flex-1 truncate">{label}</span>
      {meta && (
        <span className="ml-2 shrink-0 truncate text-[11px] capitalize text-muted-foreground">
          {meta}
        </span>
      )}
      {shortcut && (
        <kbd className="ml-2 hidden h-5 shrink-0 items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}

/**
 * Bottom hint strip — documents the chord fallbacks so power users know
 * they can summon mid-edit without ⌘K colliding with editor keybindings.
 */
function PaletteFooter() {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span>Open</span>
        <kbd className="inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          ⌘K
        </kbd>
        <span className="text-muted-foreground/50">·</span>
        <span>mid-edit</span>
        <kbd className="inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          ⌘⇧K
        </kbd>
        <span className="text-muted-foreground/50">or</span>
        <kbd className="inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          ⌘.
        </kbd>
      </div>
      <div className="hidden items-center gap-1.5 sm:flex">
        <kbd className="inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          ↵
        </kbd>
        <span>to run</span>
      </div>
    </div>
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
      overlayClassName="fixed inset-0 z-50 bg-foreground/30 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      contentClassName="fixed left-1/2 top-[18%] z-50 w-[92vw] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
    >
      <div ref={contentRef} className="flex flex-col">
        {children}
      </div>
    </Command.Dialog>
  );
}
