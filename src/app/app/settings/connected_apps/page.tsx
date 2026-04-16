import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { ConnectedAppsList } from "./connected_apps_list";

/**
 * User-facing OAuth grants management.
 *
 * Lists every app the signed-in user has ever consented to, across
 * every workspace they can see. The list is fetched by the client
 * component via `listConnectedAppsDetailAction` so the page renders
 * instantly with the shell and the data streams in — the initial
 * payload stays small (no DB calls at render time).
 *
 * Per-row, the user can:
 *   - Expand to see every scope with its plain-English description.
 *   - Revoke the grant (server action → revokes tokens + stamps
 *     consent.revoked_at + audit event).
 *
 * The raw underlying action is wrapped so ownership is verified
 * inline: the caller must own the consent being revoked. The page
 * itself only guards session presence; the server action enforces
 * role + ownership.
 */
export default async function ConnectedAppsPage() {
  await requireAuthenticatedUser();

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
          Connected Apps
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          OAuth apps you&apos;ve authorized to access your workspaces.
          Revoke any app to immediately invalidate every live token it
          holds. Tokens normally last 1 hour; refresh tokens rotate on
          every use and expire after 30 days.
        </p>
      </div>
      <Separator />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          <ConnectedAppsList />
        </div>
      </div>
    </div>
  );
}
