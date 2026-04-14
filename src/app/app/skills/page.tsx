import { Zap } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listReusableSkills } from "@/server/repositories/skill_repository";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { SkillImportTrigger } from "@/components/product/skill_import_dialog";
import { SkillCreateDialog } from "@/components/product/skill_create_dialog";
import { WorkspaceLiveRefresh } from "@/components/product/workspace_live_refresh";
import { SkillsLibraryView } from "@/components/product/skills_library_view";

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptySkills() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10">
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Zap className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">No workspace skills yet</p>
            <p className="text-xs text-muted-foreground">
              Workspace-level reusable skills will appear here. Create one with the
              New skill button, or import a packaged skill. Box-local skills live
              inside their box.
            </p>
          </div>
        </div>
      </div>
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WorkspaceLiveRefresh workspaceId={ctx.workspace.id} scope="library" />
      {/* Header */}
      <div className="border-b border-border bg-background px-4 pt-4 pb-4 md:px-6 md:pt-6">
        <div className="flex items-center gap-2.5">
          <Zap className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Skills</h1>
            <p className="text-xs text-muted-foreground">Workspace-level reusable skills shared across all boxes</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SkillCreateDialog forceReusable />
            <SkillImportTrigger />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {skills.length === 0 ? (
          <EmptySkills />
        ) : (
          <div className="mx-auto w-full max-w-7xl px-6 py-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                {skills.length} skill{skills.length === 1 ? "" : "s"}
              </p>
            </div>
            <SkillsLibraryView skills={skills} boxes={boxes} />
          </div>
        )}
      </div>
    </div>
  );
}
