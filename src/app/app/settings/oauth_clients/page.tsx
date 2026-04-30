import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createAdminClient } from "@/lib/supabase/admin";
import { listClientsForOwner } from "@/server/services/oauth_client_service";
import { PageHeader } from "@/components/product/page_header";
import { OauthClientsManager } from "./oauth_clients_manager";

/**
 * Developer OAuth clients — dedicated management surface.
 *
 * Ownership model:
 *
 *   Every signed-in user sees the OAuth clients they registered
 *   themselves (`oauth_clients.created_by = <caller>`). First-party
 *   seeded clients are excluded from this list — they are platform
 *   artefacts and are managed by administrators, not by end users.
 *   This keeps the UX simple ("these are your apps"), matches the
 *   service boundary (`listClientsForOwner`), and prevents accidental
 *   mutation of seeded clients by users who happen to be workspace
 *   admins.
 *
 * The page embeds a client component that handles list refresh,
 * register-new flow (with one-shot credential display), edit, and
 * deprecate. Server actions live in `./actions.ts` and in
 * `../developer_apps_actions.ts` (the pre-existing register /
 * rotate-secret / delete wrappers).
 */
export default async function OauthClientsPage() {
  const ctx = await requireAuthenticatedUser();
  // SSR the initial list so the page is useful without JS enabling.
  const admin = createAdminClient();
  const initialClients = await listClientsForOwner(admin, ctx.user.id);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="OAuth clients"
        description="Apps you've registered to integrate with the Context Store API via OAuth 2.1. Secrets are shown once at registration — store them somewhere safe before closing the dialog."
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
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
          <OauthClientsManager
            initialClients={initialClients.map((c) => ({
              ...c,
              last_used_at: null,
              active_token_count: 0,
              active_consent_count: 0,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
