import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getBoxById } from "@/server/repositories/box_repository";
import { listTemplates } from "@/server/services/note_template_service";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/product/empty_state";
import { PageHeader } from "@/components/product/page_header";
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
      <PageHeader
        eyebrow={box.name}
        eyebrowHref={`/app/boxes/${box.id}`}
        title="Note templates"
        description={`Reusable templates for creating notes in ${box.name}. Use {{variable}} placeholders for dynamic content.`}
      />

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
  );
}
