import { notFound } from "next/navigation";
import { Calendar, Tag, Zap } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getSkillById } from "@/server/repositories/skill_repository";
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
}: {
  params: Promise<{ skill_id: string }>;
}) {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const { skill_id } = await params;

  const skill = await getSkillById(supabase, skill_id);
  if (!skill || skill.workspace_id !== ctx.workspace.id) notFound();

  const createdDate = new Date(skill.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

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
          {skill.is_reusable && (
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Reusable
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-6 space-y-6">
          {/* Metadata */}
          <section className="rounded-lg border border-border bg-card p-4 space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Details</h2>
            <MetaRow label="Format">{skill.canonical_format}</MetaRow>
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
        </div>
      </div>
    </div>
  );
}
