import { notFound } from "next/navigation";
import { Calendar, Tag, Zap } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getSkillById } from "@/server/repositories/skill_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { isObjectAttachedToBox, listAttachmentsForObject } from "@/server/repositories/box_object_attachment_repository";
import { listObjectVersions } from "@/server/repositories/object_version_repository";
import { listPendingProposalsForObject } from "@/server/repositories/write_proposal_repository";
import { ReferenceContextBanner } from "@/components/product/reference_context_banner";
import { SkillExportMenu } from "@/components/product/export_menu";
import { ObjectTrustHeader } from "@/components/product/object_trust_header";
import { MachineProvenancePanel } from "@/components/product/machine_provenance_panel";
import { SkillHistoryPanel, SkillLifecycleControls } from "@/components/product/skill_trust_panels";
import { cn } from "@/lib/utils";

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

  const skill = await getSkillById(supabase, skill_id);
  if (!skill || skill.workspace_id !== ctx.workspace.id) notFound();

  // Fetch version history, pending proposals, and attachment count in parallel
  const [versions, pendingProposals, attachments] = await Promise.all([
    listObjectVersions(supabase, "skill", skill_id, { limit: 50 }),
    listPendingProposalsForObject(supabase, ctx.workspace.id, "skill", skill_id),
    skill.is_reusable
      ? listAttachmentsForObject(supabase, ctx.workspace.id, "skill", skill_id)
      : Promise.resolve([]),
  ]);

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

  const createdDate = new Date(skill.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const rollbackDisabled = skill.status === "archived" || skill.status === "trashed";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border bg-background px-6 pt-6 pb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted mt-0.5">
            <Zap className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight text-foreground truncate">{skill.name}</h1>
            {skill.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">{skill.description}</p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <SkillExportMenu skillId={skill_id} skillName={skill.name} />
          </div>
        </div>
      </div>

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

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">

          {/* Trust header */}
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

          {/* Machine provenance */}
          <MachineProvenancePanel
            originType={skill.origin_type as "user_created" | "imported" | "generated"}
            createdAt={skill.created_at}
            pendingProposalCount={pendingProposals.length}
            objectName={skill.name}
          />

          {/* Metadata */}
          <section className="rounded-lg border border-border bg-card p-4 space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Details</h2>
            <MetaRow label="Format">{skill.canonical_format}</MetaRow>
            <MetaRow label="Status">{skill.status}</MetaRow>
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

          {/* Source content */}
          {skill.source_content && (
            <section className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Source <span className="font-normal normal-case text-muted-foreground/60">({skill.canonical_format})</span>
              </h2>
              <pre className={cn(
                "whitespace-pre-wrap break-words text-xs text-foreground/80",
                "font-mono leading-6 max-h-96 overflow-auto"
              )}>
                {skill.source_content}
              </pre>
            </section>
          )}

          {/* Version history */}
          <SkillHistoryPanel
            skillId={skill_id}
            versions={versionsWithCurrent}
            currentVersionId={skill.current_version_id ?? null}
            rollbackDisabled={rollbackDisabled}
          />

          {/* Lifecycle controls */}
          <section className="rounded-lg border border-border bg-card p-4">
            <SkillLifecycleControls
              skillId={skill_id}
              currentStatus={skill.status as "draft" | "active" | "archived" | "trashed"}
              skillName={skill.name}
            />
          </section>

        </div>
      </div>
    </div>
  );
}
