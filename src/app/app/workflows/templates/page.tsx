import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { PageHeader } from "@/components/product/page_header";
import { WorkflowTemplateCard } from "@/components/product/workflows/workflow_template_card";
import { WORKFLOW_TEMPLATES } from "@/server/domain/workflow_templates";

export default async function WorkflowTemplatesPage() {
  // Require auth up front — the "Use template" action also requires it, but
  // guarding the page keeps unauthenticated users from ever reaching the
  // gallery.
  await requireAuthenticatedUser();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Workflow templates"
        description="Start with a pre-built workflow and customize it."
        actions={
          <Link
            href="/app/workflows"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to workflows
          </Link>
        }
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {WORKFLOW_TEMPLATES.map((template) => (
              <WorkflowTemplateCard key={template.id} template={template} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
