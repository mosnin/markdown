import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, FileText, Plus } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getBoxById } from "@/server/repositories/box_repository";
import { listTemplates } from "@/server/services/note_template_service";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/product/empty_state";
import { TemplateListClient } from "@/components/product/template_list_client";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ box_id: string }>;
}) {
  const { box_id } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const box = await getBoxById(supabase, box_id);
  if (!box || box.workspace_id !== ctx.workspace.id) notFound();

  const templates = await listTemplates(supabase, box_id);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Header */}
        <div className="border-b border-border px-4 py-4 md:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
            <div className="min-w-0 flex-1">
              {/* Breadcrumb */}
              <nav
                aria-label="Breadcrumb"
                className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"
              >
                <Link
                  href="/app"
                  className="hover:text-foreground hover:underline underline-offset-2 transition-fast"
                >
                  {ctx.workspace.name}
                </Link>
                <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                <Link
                  href={`/app/boxes/${box.id}`}
                  className="hover:text-foreground hover:underline underline-offset-2 transition-fast"
                >
                  {box.name}
                </Link>
                <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="text-foreground/80 font-medium">Templates</span>
              </nav>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Note templates
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Reusable templates for creating notes in{" "}
                <span className="font-medium text-foreground/80">{box.name}</span>.
                Use <code className="text-xs">{"{{variable}}"}</code> placeholders
                for dynamic content.
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-3xl px-6 py-6">
            {templates.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-5 w-5" />}
                title="No templates yet"
                description="Create a template to reuse note structures. You can also save any existing note as a template."
              />
            ) : null}
            <TemplateListClient
              boxId={box.id}
              initialTemplates={templates.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                markdown_content: t.markdown_content,
                tags: t.tags,
                is_default: t.is_default,
                sort_order: t.sort_order,
                created_at: t.created_at,
                updated_at: t.updated_at,
              }))}
            />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
