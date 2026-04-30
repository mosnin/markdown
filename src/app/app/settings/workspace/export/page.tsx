import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdminRole } from "@/server/auth/require_role";
import { PageHeader } from "@/components/product/page_header";
import { ExportManager } from "./export_manager";

/**
 * Workspace export/import admin page.
 *
 * Admin-only — `requireAdminRole()` at the top of the page.
 * Provides a button to download the full workspace as JSON and
 * a file upload to import a workspace export with collision handling.
 */
export default async function WorkspaceExportPage() {
  await requireAdminRole();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        eyebrow="Workspace"
        title="Export / Import"
        description="Export your entire workspace or import content from another workspace."
        actions={
          <Link
            href="/app/settings"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto px-6 pb-8">
        <ExportManager />
      </div>
    </div>
  );
}
