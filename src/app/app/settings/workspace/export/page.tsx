import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { canAdmin } from "@/server/auth/require_role";
import { ExportManager } from "./export_manager";

/**
 * Workspace export/import admin page.
 *
 * Admin-only — `requireAdminRole()` at the top of the page.
 * Provides a button to download the full workspace as JSON and
 * a file upload to import a workspace export with collision handling.
 */
export default async function WorkspaceExportPage() {
  const ctx = await requireAuthenticatedUser();

  if (!canAdmin(ctx.workspace.role)) {
    redirect("/app");
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-background px-6 pt-6 pb-4">
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            href="/app/settings"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to settings
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Export / Import
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Export your entire workspace or import content from another workspace.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-8">
        <ExportManager />
      </div>
    </div>
  );
}
