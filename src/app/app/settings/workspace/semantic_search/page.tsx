import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { canAdmin } from "@/server/auth/require_role";
import { PageHeader } from "@/components/product/page_header";
import { ReindexPanel } from "./reindex_button";

/**
 * Workspace admin surface for semantic search.
 *
 * Today this page hosts a single control: a "Reindex workspace" button
 * that walks every note in the workspace and (re)computes its vector
 * embedding. Future controls (embedding model choice, per-box opt-out,
 * index health stats) would land on this same page.
 *
 * Any workspace member can view the page so the rules are discoverable,
 * but only admins get the editable controls. The underlying action is
 * also admin-gated server-side.
 */
export default async function SemanticSearchSettingsPage() {
  const ctx = await requireAuthenticatedUser();
  const isAdmin = canAdmin(ctx.workspace.role);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Semantic search"
        description="Vector embeddings power search by meaning across your workspace's notes. The embed worker keeps new and edited notes fresh automatically — use this page to force a full reindex after a bulk import or embedding model change."
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

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          <ReindexPanel canEdit={isAdmin} />
        </div>
      </div>
    </div>
  );
}
