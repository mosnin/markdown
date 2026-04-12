import { Zap } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listReusableSkills } from "@/server/repositories/skill_repository";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import Link from "next/link";
import { AttachToBoxTrigger } from "@/components/product/attach_to_box_trigger";
import { SkillImportTrigger } from "@/components/product/skill_import_dialog";
import { SkillCreateDialog } from "@/components/product/skill_create_dialog";
import { WorkspaceLiveRefresh } from "@/components/product/workspace_live_refresh";
import { cn } from "@/lib/utils";

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

// ─── Skill card ───────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  boxes,
}: {
  skill: { id: string; name: string; description: string | null; canonical_format: string; tags: string[] };
  boxes: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="relative flex flex-col gap-0">
      <Link
        href={`/app/skills/${skill.id}`}
        className={cn(
          "flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4",
          "transition-colors duration-150 hover:bg-accent/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground truncate">{skill.name}</span>
          <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {skill.canonical_format}
          </span>
        </div>
        {skill.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {skill.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {tag}
            </span>
          ))}
          <div className="ml-auto">
            <AttachToBoxTrigger
              objectType="skill"
              objectId={skill.id}
              objectName={skill.name}
              boxes={boxes}
            />
          </div>
        </div>
      </Link>
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
      <div className="border-b border-border bg-background px-6 pt-6 pb-4">
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} boxes={boxes} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
