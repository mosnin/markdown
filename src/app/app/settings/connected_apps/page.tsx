import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { PageHeader } from "@/components/product/page_header";
import { ConnectedAppsTabs } from "./connected_apps_tabs";

/**
 * User-facing OAuth grants management + Send-to-AI pull-link management.
 *
 * Two tabs:
 *   * **OAuth apps** — every app the signed-in user has consented to,
 *     across every workspace they can see (existing surface).
 *   * **Pull links** — short-lived pull-tokens issued via Send to AI.
 *     Active count badged on the tab; full list with bucketed
 *     active / expired-or-revoked sections inside.
 *
 * Both surfaces stream their data in via server actions on mount,
 * so the page shell paints instantly. Page-level guard is session
 * presence; per-action ownership + role checks live in the actions.
 */
export default async function ConnectedAppsPage() {
  await requireAuthenticatedUser();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Connected apps"
        description="OAuth apps you've authorized and short-lived pull links you've issued for AI agents. Revoke either to invalidate access immediately."
        actions={
          <Link
            href="/app/settings"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to settings
          </Link>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          <ConnectedAppsTabs />
        </div>
      </div>
    </div>
  );
}
