import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { canAdmin } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import { getCanonicalBaseUrl } from "@/lib/canonical_url";
import { listRelayKeys } from "@/server/services/relay_key_service";
import { Separator } from "@/components/ui/separator";
import { RelayKeysManager } from "./relay_keys_manager";

/**
 * Relay keys — the credential hooks carry.
 *
 * Admin-only: a relay key appends to this workspace's session log from any
 * machine on the internet. It reaches nothing else, and the log is append-only
 * at the database level, so the blast radius of a leaked key is "someone can
 * add noise to your history" rather than "someone can rewrite it".
 */
export default async function RelayKeysPage() {
  const ctx = await requireAuthenticatedUser();

  if (!canAdmin(ctx.workspace.role)) {
    redirect("/app");
  }

  const supabase = await createClient();
  const keys = await listRelayKeys(supabase, ctx.workspace.id);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-background px-6 pt-6 pb-4">
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            href="/app/settings"
            className="flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            Settings
          </Link>
        </div>
        <h1 className="text-xl font-semibold text-foreground">Relay keys</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The credential your agents&apos; hooks use to log what they are doing.
          Install one on each machine that runs an agent; without it nothing is
          captured and handoff briefs stay empty.
        </p>
        <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
          A relay key can append to this workspace&apos;s session log and read
          its briefs. It cannot modify or delete anything already logged — the
          log is append-only in the database, not just in the application.
        </p>
      </div>

      <Separator />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <RelayKeysManager
          initialKeys={keys}
          apiUrl={getCanonicalBaseUrl()}
        />
      </div>
    </div>
  );
}
