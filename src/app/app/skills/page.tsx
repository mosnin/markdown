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
import { SkillsPageHeader } from "@/components/product/skills/skills_page_header";

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptySkills() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="rounded-lg border border-border p-3">
        <Zap className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium">No workspace skills yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Create one with the New skill button, or import a packaged skill.
        </p>
      </div>
      <SkillCreateDialog forceReusable />
    </div>
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

      {/* Animated page header — client component */}
      <SkillsPageHeader>
        <div className="ml-auto flex items-center gap-2">
          <SkillCreateDialog forceReusable />
          <SkillImportTrigger />
        </div>
      </SkillsPageHeader>

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
