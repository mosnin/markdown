import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { canAdmin } from "@/server/auth/require_role";
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
          Semantic search
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vector embeddings power &ldquo;search by meaning&rdquo; across your
          workspace&rsquo;s notes. The embed worker keeps new and edited
          notes fresh automatically &mdash; use this page when you want to
          force a full reindex after a bulk import or embedding model
          change.
        </p>
      </div>
      <Separator />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          <ReindexPanel canEdit={isAdmin} />
        </div>
      </div>
    </div>
  );
}
