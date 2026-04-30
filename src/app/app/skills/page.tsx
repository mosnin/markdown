import { Zap } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listReusableSkills } from "@/server/repositories/skill_repository";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { SkillImportTrigger } from "@/components/product/skills/skill_import_dialog";
import { SkillCreateDialog } from "@/components/product/skills/skill_create_dialog";
import { WorkspaceLiveRefresh } from "@/components/product/workspace/workspace_live_refresh";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";
import { SkillsListClient } from "@/components/product/skills/skills_list_client";
import { PageHeader } from "@/components/product/page_header";
import { EmptyState } from "@/components/product/empty_state";

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptySkills() {
  return (
    <EmptyState
      icon={<Zap />}
      title="No workspace skills yet"
      description="Workspace-level reusable skills will appear here. Create one with the New skill button, or import a packaged skill. Box-local skills live inside their box."
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SkillsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const [skills, boxes] = await Promise.all([
    listReusableSkills(supabase, ctx.workspace.id),
    listBoxesByWorkspace(supabase, ctx.workspace.id),
  ]);

  const allTags = [...new Set(skills.flatMap((s) => s.tags))].sort();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ActiveBranchBannerServer />
      <WorkspaceLiveRefresh workspaceId={ctx.workspace.id} scope="library" />
      <PageHeader
        title="Skills"
        description="Workspace-level reusable skills shared across every box."
        actions={
          <>
            <SkillCreateDialog forceReusable />
            <SkillImportTrigger />
          </>
        }
      />

      <div className="flex-1 overflow-auto">
        {skills.length === 0 ? (
          <EmptySkills />
        ) : (
          <SkillsListClient skills={skills} boxes={boxes} allTags={allTags} />
        )}
      </div>
    </div>
  );
}
