import { notFound } from "next/navigation";
import { Calendar, File, Tag, Zap } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";
import { createClient } from "@/lib/supabase/server";
import { getSkillById } from "@/server/repositories/skill_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { isObjectAttachedToBox, listAttachmentsForObject } from "@/server/repositories/box_object_attachment_repository";
import { listObjectVersions } from "@/server/repositories/object_version_repository";
import { listPendingProposalsForObject } from "@/server/repositories/write_proposal_repository";
import { getLinksForObject } from "@/server/services/object_link_service";
import { listFilesByBox } from "@/server/repositories/file_repository";
import { listFoldersByBox } from "@/server/repositories/folder_repository";
import { ReferenceContextBanner } from "@/components/product/reference_context_banner";
import { SkillExportMenu } from "@/components/product/export_menu";
import { CopyAsJsonButton } from "@/components/product/copy_as_json_button";
import { ObjectTrustHeader } from "@/components/product/object_trust_header";
import { MachineProvenancePanel } from "@/components/product/machine_provenance_panel";
import { SkillHistoryPanel, SkillLifecycleControls } from "@/components/product/skills/skill_trust_panels";
import { SkillSourceEditor } from "@/components/product/skills/skill_source_editor";
import { SkillChildrenPanel } from "@/components/product/skills/skill_children_panel";
import { SkillTestSandbox } from "@/components/product/skills/skill_test_sandbox";
import { SkillSubagentPanel } from "@/components/product/skills/skill_subagent_panel";
import { OBJECT_TYPE } from "@/server/domain/constants/object_constants";
import { WorkspaceLiveRefresh } from "@/components/product/workspace/workspace_live_refresh";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/product/page_header";
import { formatAbsoluteDate } from "@/lib/format_date";

// ─── Meta row ─────────────────────────────────────────────────────────────────

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SkillPage({
  params,
  searchParams,
}: {
  params: Promise<{ skill_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const { skill_id } = await params;
  const resolvedSearch = await searchParams;
  const boxContextId = typeof resolvedSearch.box_id === "string" ? resolvedSearch.box_id : null;

  let skill = await getSkillById(supabase, skill_id);
  if (!skill || skill.workspace_id !== ctx.workspace.id) notFound();

  // Branch-aware read: when an active branch has a head for this
  // skill's canonical source, patch the content fields from the
  // branch version so the editor opens the branch's view. Non-
  // versioned fields stay on main.
  if (ctx.activeBranchId && skill) {
    const { resolveBranchObjectVersion } = await import(
      "@/server/services/object_branch_service"
    );
    const branchVer = await resolveBranchObjectVersion(
      supabase, ctx.activeBranchId, "skill", skill_id
    );
    if (branchVer) {
      skill = {
        ...skill,
        source_content: branchVer.source_content,
        content_bytes: branchVer.content_bytes,
        current_version_id: branchVer.id,
      };
    }
  }

  // Sub-agent config lives on three columns that aren't yet part of
  // the Skill domain type (added by migration 20260425000001). Read
  // them directly for the editor panel.
  const subagentConfigPromise = supabase
    .from("skills")
    .select("is_subagent, subagent_tools, subagent_max_turns")
    .eq("id", skill_id)
    .maybeSingle()
    .then((res) => res.data ?? null);

  const [versions, pendingProposals, attachments, links, boxFiles, boxFolders, subagentConfig] = await Promise.all([
    listObjectVersions(supabase, "skill", skill_id, { limit: 50 }),
    listPendingProposalsForObject(supabase, ctx.workspace.id, "skill", skill_id),
    skill.is_reusable
      ? listAttachmentsForObject(supabase, ctx.workspace.id, "skill", skill_id)
      : Promise.resolve([]),
    getLinksForObject(supabase, ctx.workspace.id, OBJECT_TYPE.SKILL, skill_id),
    skill.box_id
      ? listFilesByBox(supabase, skill.box_id, { includeArchived: true, branchId: ctx.activeBranchId })
      : Promise.resolve([]),
    skill.box_id
      ? listFoldersByBox(supabase, skill.box_id, {
          includeArchived: true,
          branchId: ctx.activeBranchId,
        })
      : Promise.resolve([]),
    subagentConfigPromise,
  ]);

  const childLinkIds = new Set(
    links.outgoing
      .filter((l) => l.relationship_type === "parent_of")
      .map((l) => `${l.target_object_type}:${l.target_object_id}`)
  );

  // Load reusable linked files for workspace-level skills (no box_id)
  const linkedFileIds = links.outgoing
    .filter((l) => l.relationship_type === "parent_of" && l.target_object_type === OBJECT_TYPE.FILE)
    .map((l) => l.target_object_id);
  const linkedFolderIds = links.outgoing
    .filter((l) => l.relationship_type === "parent_of" && l.target_object_type === OBJECT_TYPE.FOLDER)
    .map((l) => l.target_object_id);

  const reusableLinkedFiles = (!skill.box_id && linkedFileIds.length > 0)
    ? await supabase
        .from("files")
        .select("id, name")
        .in("id", linkedFileIds)
        .eq("workspace_id", ctx.workspace.id)
        .then((res) => res.data ?? [])
    : [];

  const reusableLinkedFolders = (!skill.box_id && linkedFolderIds.length > 0)
    ? await supabase
        .from("folders")
        .select("id, name")
        .in("id", linkedFolderIds)
        .eq("workspace_id", ctx.workspace.id)
        .then((res) => res.data ?? [])
    : [];

  const childrenItems = [
    ...boxFolders.filter((f) => childLinkIds.has(`folder:${f.id}`)).map((f) => ({
      id: f.id,
      type: "folder" as const,
      name: f.name,
      href: `/app/folders/${f.id}`,
    })),
    ...reusableLinkedFolders.map((f) => ({
      id: f.id,
      type: "folder" as const,
      name: f.name,
      href: `/app/folders/${f.id}`,
    })),
    ...boxFiles.filter((f) => childLinkIds.has(`file:${f.id}`)).map((f) => ({
      id: f.id,
      type: "file" as const,
      name: f.name,
      href: `/app/files/${f.id}`,
    })),
    ...reusableLinkedFiles.map((f) => ({
      id: f.id,
      type: "file" as const,
      name: f.name,
      href: `/app/files/${f.id}`,
    })),
  ];

  const versionsWithCurrent = versions.map((v) => ({
    ...v,
    is_current: v.id === skill.current_version_id,
  }));

  // Reference context: reusable skill viewed from a specific box via ?box_id=
  let refBox: { id: string; name: string } | null = null;
  if (skill.is_reusable && boxContextId) {
    const candidate = await getBoxById(supabase, boxContextId);
    if (candidate && candidate.workspace_id === ctx.workspace.id) {
      const attached = await isObjectAttachedToBox(supabase, boxContextId, "skill", skill_id);
      if (attached) refBox = { id: candidate.id, name: candidate.name };
    }
  }

  // Pin to en-US via the shared helper so server and client hydration
  // produce identical output regardless of the user's OS locale. The
  // previous call used `undefined` locale — a guaranteed mismatch on
  // non-US systems. See src/lib/format_date.ts.
  const createdDate = formatAbsoluteDate(skill.created_at);

  const rollbackDisabled = skill.status === "archived" || skill.status === "trashed";

  const sandboxBoxId = attachments.length > 0 ? attachments[0].box_id : null;

  const skillExportData = {
    _type: "pog_skill",
    _version: "1",
    name: skill.name,
    description: skill.description,
    canonical_format: skill.canonical_format,
    tags: skill.tags,
    source_content: skill.source_content,
    is_reusable: skill.is_reusable,
    origin_type: skill.origin_type,
    exported_at: new Date().toISOString(),
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ActiveBranchBannerServer objectType="skill" objectId={skill_id} />
      <WorkspaceLiveRefresh
        workspaceId={ctx.workspace.id}
        scope="object"
        objectType="skill"
        objectId={skill_id}
        protectWhileEditing
      />

      <PageHeader
        eyebrow="Skills"
        eyebrowHref="/app/skills"
        title={skill.name}
        description={skill.description ?? undefined}
        actions={
          <>
            <CopyAsJsonButton data={skillExportData} label="Copy JSON" />
            <SkillExportMenu skillId={skill_id} skillName={skill.name} />
          </>
        }
      />

      {/* Reference context banner */}
      {refBox && (
        <div className="border-b border-border px-6 py-3">
          <ReferenceContextBanner
            boxId={refBox.id}
            boxName={refBox.name}
            objectType="skill"
            objectId={skill_id}
          />
        </div>
      )}

      {/* Tabbed content */}
      <Tabs defaultValue="overview" className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-6">
          <TabsList variant="line" className="h-auto pb-0">
            <TabsTrigger value="overview" className="pb-3">Overview</TabsTrigger>
            <TabsTrigger value="source" className="pb-3">Source</TabsTrigger>
            <TabsTrigger value="children" className="pb-3">
              Files
              {childrenItems.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px] font-normal">
                  {childrenItems.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="pb-3">History</TabsTrigger>
            <TabsTrigger value="sandbox" className="pb-3">Try it</TabsTrigger>
            <TabsTrigger value="subagent" className="pb-3">Sub-agent</TabsTrigger>
          </TabsList>
        </div>

        {/* ── Overview tab ── */}
        <TabsContent value="overview" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">
              <ObjectTrustHeader
                objectType="skill"
                objectName={skill.name}
                isReusable={skill.is_reusable}
                attachedBoxCount={attachments.length}
                pendingProposalCount={pendingProposals.length}
                lifecycleStatus={skill.status as "draft" | "active" | "archived" | "trashed"}
                isGenerated={skill.origin_type === "generated"}
                canonicalFormat={skill.canonical_format}
              />

              <MachineProvenancePanel
                originType={skill.origin_type as "user_created" | "imported" | "generated"}
                createdAt={skill.created_at}
                pendingProposalCount={pendingProposals.length}
                objectName={skill.name}
              />

              <section className="rounded-lg border border-border bg-card p-4 space-y-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Details</h2>
                <MetaRow label="Format">{skill.canonical_format}</MetaRow>
                <MetaRow label="Status">{skill.status}</MetaRow>
                <MetaRow label="Scope">{skill.is_reusable ? "Workspace reusable" : "Box local"}</MetaRow>
                <MetaRow label="Created">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" aria-hidden="true" />
                    {createdDate}
                  </span>
                </MetaRow>
                {skill.tags.length > 0 && (
                  <MetaRow label="Tags">
                    <span className="flex flex-wrap gap-1">
                      {skill.tags.map((tag) => (
                        <span key={tag} className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                          {tag}
                        </span>
                      ))}
                    </span>
                  </MetaRow>
                )}
              </section>

              <section className="rounded-lg border border-border bg-card p-4">
                <SkillLifecycleControls
                  skillId={skill_id}
                  currentStatus={skill.status as "draft" | "active" | "archived" | "trashed"}
                  skillName={skill.name}
                />
              </section>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Source tab ── */}
        <TabsContent value="source" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">
              <section className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Canonical source <span className="font-normal normal-case text-muted-foreground/60">({skill.canonical_format})</span>
                </h2>
                <p className="text-xs text-muted-foreground">
                  This is the single canonical editable source file for this skill.
                  Supporting files can be added in the Files tab.
                </p>
                <SkillSourceEditor skill={skill} />
              </section>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Children / Files tab ── */}
        <TabsContent value="children" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="mx-auto max-w-3xl px-6 py-6">
              <div className="mb-4 space-y-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Supporting files and folders
                </h2>
                <p className="text-xs text-muted-foreground">
                  Child files and nested folders that make up this skill&#39;s internal package structure.
                  The canonical source is edited in the Source tab — these are supporting artifacts.
                </p>
              </div>
              <SkillChildrenPanel skillId={skill_id} childrenItems={childrenItems} canCreateFolders={true} />
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── History tab ── */}
        <TabsContent value="history" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="mx-auto max-w-3xl px-6 py-6">
              <SkillHistoryPanel
                skillId={skill_id}
                versions={versionsWithCurrent}
                currentVersionId={skill.current_version_id ?? null}
                rollbackDisabled={rollbackDisabled}
              />
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Try it / sandbox tab ── */}
        <TabsContent value="sandbox" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <SkillTestSandbox
              skill={{
                id: skill.id,
                name: skill.name,
                source_content: skill.source_content,
              }}
              defaultBoxId={sandboxBoxId}
            />
          </ScrollArea>
        </TabsContent>

        {/* ── Sub-agent tab ── */}
        <TabsContent value="subagent" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">
              <SkillSubagentPanel
                skillId={skill_id}
                initialIsSubagent={subagentConfig?.is_subagent ?? false}
                initialTools={(subagentConfig?.subagent_tools as string[] | null | undefined) ?? null}
                initialMaxTurns={(subagentConfig?.subagent_max_turns as number | null | undefined) ?? null}
              />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
