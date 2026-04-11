import { notFound } from "next/navigation";
import { Archive, Bot, ChevronRight, History, Trash2 } from "lucide-react";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getAgentForWorkspace } from "@/server/services/agent_service";
import { getBoxById } from "@/server/repositories/box_repository";
import { getLinksForObject } from "@/server/services/object_link_service";
import { listObjectVersions } from "@/server/repositories/object_version_repository";
import { listAttachmentsForObject } from "@/server/repositories/box_object_attachment_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { listFilesByBox } from "@/server/repositories/file_repository";
import { listSkillsByBox } from "@/server/repositories/skill_repository";
import { listAgentsByBox } from "@/server/repositories/agent_repository";
import { listReusableAgents } from "@/server/services/agent_service";
import { OBJECT_TYPE } from "@/server/domain/constants/object_constants";
import { type ObjectLink } from "@/server/domain/types/object_link";
import { AgentSourceEditor } from "@/components/product/agent_source_editor";
import { AgentOverviewPanel } from "@/components/product/agent_overview_panel";
import { AgentExportsPanel } from "@/components/product/agent_exports_panel";
import { AgentChildrenPanel } from "@/components/product/agent_children_panel";
import { AgentSkillsPanel } from "@/components/product/agent_skills_panel";
import { AgentContextPanel } from "@/components/product/agent_context_panel";
import { AgentObjectLinksPanel } from "@/components/product/agent_object_links_panel";
import { AgentLifecycleMenu } from "@/components/product/agent_lifecycle_menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentTypeBadge } from "@/components/product/agent_type_badge";
import { AgentReferenceBadge } from "@/components/product/agent_reference_badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  type ResolvedAgentLink,
  type AgentLinkTarget,
} from "@/components/product/agent_object_links_panel";
import { type ObjectType } from "@/server/domain/constants/object_constants";
import { cn } from "@/lib/utils";

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  workspaceName,
  boxId,
  boxName,
  agentName,
  isReusable,
}: {
  workspaceName: string;
  boxId: string | null;
  boxName: string | null;
  agentName: string;
  isReusable: boolean;
}) {
  type Part = { label: string; href: string | null };
  const parts: Part[] = [
    { label: workspaceName, href: "/app" },
    ...(isReusable
      ? [{ label: "Agents", href: "/app/agents" as string | null }]
      : boxId && boxName
        ? [{ label: boxName, href: `/app/boxes/${boxId}` as string | null }]
        : []),
    { label: agentName, href: null },
  ];

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
      {parts.map((part, i) => (
        <span key={`${part.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
          {part.href ? (
            <Link
              href={part.href}
              className="hover:text-foreground hover:underline underline-offset-2 transition-fast"
            >
              {part.label}
            </Link>
          ) : i === parts.length - 1 ? (
            <span className="max-w-[200px] truncate font-medium text-foreground/80" title={part.label}>
              {part.label}
            </span>
          ) : (
            <span>{part.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

// ─── Link resolution ──────────────────────────────────────────────────────────

function resolveLink(
  link: ObjectLink,
  noteMap: Map<string, { id: string; title: string }>,
  fileMap: Map<string, { id: string; name: string; file_extension: string | null }>,
  skillMap: Map<string, { id: string; name: string }>,
  agentMap: Map<string, { id: string; name: string }>
): ResolvedAgentLink | null {
  const isOutgoing = link.source_object_type === OBJECT_TYPE.AGENT;
  const linkedType = (isOutgoing ? link.target_object_type : link.source_object_type) as ObjectType;
  const linkedId = isOutgoing ? link.target_object_id : link.source_object_id;

  let linkedName = `Unknown ${linkedType}`;
  let linkedHref = "#";

  if (linkedType === OBJECT_TYPE.NOTE) {
    const note = noteMap.get(linkedId);
    if (note) { linkedName = note.title; linkedHref = `/app/notes/${linkedId}`; }
  } else if (linkedType === OBJECT_TYPE.FILE) {
    const file = fileMap.get(linkedId);
    if (file) { linkedName = file.name + (file.file_extension ?? ""); linkedHref = `/app/files/${linkedId}`; }
  } else if (linkedType === OBJECT_TYPE.SKILL) {
    const skill = skillMap.get(linkedId);
    if (skill) { linkedName = skill.name; linkedHref = `/app/skills/${linkedId}`; }
  } else if (linkedType === OBJECT_TYPE.AGENT) {
    const agent = agentMap.get(linkedId);
    if (agent) { linkedName = agent.name; linkedHref = `/app/agents/${linkedId}`; }
  }

  return {
    id: link.id,
    relationship_type: link.relationship_type as ResolvedAgentLink["relationship_type"],
    relationship_note: link.relationship_note,
    linkedObjectType: linkedType,
    linkedObjectId: linkedId,
    linkedName,
    linkedHref,
  };
}

// ─── Valid tabs ───────────────────────────────────────────────────────────────

const VALID_TABS = ["overview", "source", "exports", "children", "skills", "relationships"] as const;
type AgentTab = typeof VALID_TABS[number];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ agent_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agent_id } = await params;
  const resolvedSearch = await searchParams;
  const rawTab = typeof resolvedSearch.tab === "string" ? resolvedSearch.tab : "overview";
  const defaultTab: AgentTab = VALID_TABS.includes(rawTab as AgentTab)
    ? (rawTab as AgentTab)
    : "overview";

  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const agent = await getAgentForWorkspace(supabase, agent_id, ctx.workspace.id);
  if (!agent) notFound();

  const box = agent.box_id ? await getBoxById(supabase, agent.box_id) : null;

  // Parallel data fetching
  const [rawLinks, versions, attachments, boxNotes, boxFiles, boxSkills, boxAgents, reusableAgents] =
    await Promise.all([
      getLinksForObject(supabase, ctx.workspace.id, OBJECT_TYPE.AGENT, agent_id),
      listObjectVersions(supabase, "agent", agent_id, { limit: 50 }),
      agent.is_reusable
        ? listAttachmentsForObject(supabase, ctx.workspace.id, "agent", agent_id)
        : Promise.resolve([]),
      agent.box_id ? listNotesByBox(supabase, agent.box_id) : Promise.resolve([]),
      agent.box_id ? listFilesByBox(supabase, agent.box_id) : Promise.resolve([]),
      agent.box_id ? listSkillsByBox(supabase, agent.box_id) : Promise.resolve([]),
      agent.box_id ? listAgentsByBox(supabase, agent.box_id) : Promise.resolve([]),
      // For workspace-level reusable agents, also load reusable skills/agents for linking
      !agent.box_id
        ? listReusableAgents(supabase, ctx.workspace.id)
        : Promise.resolve([]),
    ]);

  // Resolution maps
  const noteMap = new Map(boxNotes.map((n) => [n.id, { id: n.id, title: n.title }]));
  const fileMap = new Map(
    boxFiles.filter((f) => f.id !== agent_id).map((f) => [f.id, { id: f.id, name: f.name, file_extension: f.file_extension }])
  );
  const skillMap = new Map(boxSkills.map((s) => [s.id, { id: s.id, name: s.name }]));
  const agentMap = new Map(
    [...boxAgents, ...reusableAgents]
      .filter((a) => a.id !== agent_id)
      .map((a) => [a.id, { id: a.id, name: a.name }])
  );

  // Resolve links
  const outgoingLinks: ResolvedAgentLink[] = rawLinks.outgoing
    .map((l) => resolveLink(l, noteMap, fileMap, skillMap, agentMap))
    .filter((l): l is ResolvedAgentLink => l !== null);
  const incomingLinks: ResolvedAgentLink[] = rawLinks.incoming
    .map((l) => resolveLink(l, noteMap, fileMap, skillMap, agentMap))
    .filter((l): l is ResolvedAgentLink => l !== null);

  // Build eligible link targets for the add-link dialog
  const eligibleLinkTargets: AgentLinkTarget[] = [
    ...boxNotes.map((n) => ({
      id: n.id,
      objectType: "note" as const,
      name: n.title,
    })),
    ...boxFiles.filter((f) => f.id !== agent_id).map((f) => ({
      id: f.id,
      objectType: "file" as const,
      name: f.name,
      extension: f.file_extension,
    })),
    ...boxSkills.map((s) => ({
      id: s.id,
      objectType: "skill" as const,
      name: s.name,
    })),
    ...[...boxAgents, ...reusableAgents]
      .filter((a) => a.id !== agent_id)
      .map((a) => ({
        id: a.id,
        objectType: "agent" as const,
        name: a.name,
      })),
  ];

  // Children panel data: all outgoing links to file/note objects
  const structuralLinks = outgoingLinks.filter(
    (l) => l.linkedObjectType === OBJECT_TYPE.FILE || l.linkedObjectType === OBJECT_TYPE.NOTE
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Center — main workspace */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <Breadcrumb
              workspaceName={ctx.workspace.name}
              boxId={box?.id ?? null}
              boxName={box?.name ?? null}
              agentName={agent.name}
              isReusable={agent.is_reusable}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Status badges */}
            {agent.status === "archived" && (
              <Badge variant="secondary" className="flex items-center gap-1 text-[10px] font-normal">
                <Archive className="h-3 w-3" aria-hidden="true" />
                Archived
              </Badge>
            )}
            {agent.status === "trashed" && (
              <Badge variant="secondary" className="flex items-center gap-1 text-[10px] font-normal text-destructive">
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                Trash
              </Badge>
            )}
            {/* History shortcut */}
            <Link
              href="?tab=history"
              aria-label="Version history"
              title="Version history"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-fast",
                "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">History</span>
            </Link>
            {/* Lifecycle menu */}
            <AgentLifecycleMenu
              agentId={agent_id}
              agentStatus={agent.status as "draft" | "active" | "archived" | "trashed"}
            />
          </div>
        </div>

        {/* Agent header */}
        <div className="border-b border-border bg-background px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted mt-0.5">
              <Bot className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-foreground truncate">
                  {agent.name}
                </h1>
                <AgentReferenceBadge isReusable={agent.is_reusable} />
                {agent.agent_type && <AgentTypeBadge agentType={agent.agent_type} subtle />}
              </div>
              {agent.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{agent.description}</p>
              )}
            </div>
          </div>
        </div>

        {/* Tabbed workspace */}
        <Tabs defaultValue={defaultTab} className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-border px-6">
            <TabsList variant="line" className="h-auto pb-0">
              <TabsTrigger value="overview" className="pb-2.5 text-xs">Overview</TabsTrigger>
              <TabsTrigger value="source" className="pb-2.5 text-xs">Source</TabsTrigger>
              <TabsTrigger value="exports" className="pb-2.5 text-xs">Exports</TabsTrigger>
              <TabsTrigger value="children" className="pb-2.5 text-xs">
                Children
                {structuralLinks.length > 0 && (
                  <span className="ml-1 rounded-full bg-muted px-1 text-[10px] text-muted-foreground">
                    {structuralLinks.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="skills" className="pb-2.5 text-xs">
                Skills
                {outgoingLinks.filter((l) => l.linkedObjectType === "skill" || l.linkedObjectType === "file").length > 0 && (
                  <span className="ml-1 rounded-full bg-muted px-1 text-[10px] text-muted-foreground">
                    {outgoingLinks.filter((l) => l.linkedObjectType === "skill" || l.linkedObjectType === "file").length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="relationships" className="pb-2.5 text-xs">
                Relationships
                {(outgoingLinks.length + incomingLinks.length) > 0 && (
                  <span className="ml-1 rounded-full bg-muted px-1 text-[10px] text-muted-foreground">
                    {outgoingLinks.length + incomingLinks.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="flex-1 overflow-hidden">
            <AgentOverviewPanel
              agent={agent}
              boxName={box?.name ?? null}
              boxId={box?.id ?? null}
              workspaceName={ctx.workspace.name}
              outgoingLinks={outgoingLinks}
              incomingLinks={incomingLinks}
              versionCount={versions.length}
              attachmentCount={attachments.length}
            />
          </TabsContent>

          <TabsContent value="source" className="flex-1 overflow-hidden">
            <AgentSourceEditor agent={agent} />
          </TabsContent>

          <TabsContent value="exports" className="flex-1 overflow-hidden">
            <AgentExportsPanel agent={agent} />
          </TabsContent>

          <TabsContent value="children" className="flex-1 overflow-hidden">
            <AgentChildrenPanel structuralLinks={structuralLinks} agentId={agent_id} />
          </TabsContent>

          <TabsContent value="skills" className="flex-1 overflow-hidden">
            <AgentSkillsPanel outgoingLinks={outgoingLinks} />
          </TabsContent>

          <TabsContent value="relationships" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-2xl px-6 py-6">
                <AgentObjectLinksPanel
                  agentId={agent_id}
                  outgoing={outgoingLinks}
                  incoming={incomingLinks}
                  eligibleTargets={eligibleLinkTargets}
                />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>

      {/* Right panel — agent context */}
      <aside
        aria-label="Agent context panel"
        className="hidden lg:flex lg:h-full lg:w-72 lg:shrink-0 lg:flex-col lg:border-l lg:border-border lg:bg-background"
      >
        <AgentContextPanel
          agent={agent}
          boxId={box?.id ?? null}
          boxName={box?.name ?? null}
          workspaceName={ctx.workspace.name}
          outgoingLinks={outgoingLinks}
          incomingLinks={incomingLinks}
          eligibleLinkTargets={eligibleLinkTargets}
          versions={versions}
          defaultTab="info"
        />
      </aside>
    </div>
  );
}
