import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdminRole } from "@/server/auth/require_role";
import { Separator } from "@/components/ui/separator";
import { MigrationDashboard } from "./migration_dashboard";

/**
 * Legacy connection migration page.
 *
 * Admin-only surface that shows all legacy csk_v1_ connections in the
 * workspace alongside their migration status (whether an equivalent
 * OAuth client exists). Provides a guided path to register OAuth
 * replacements and deprecate legacy connections.
 */
export default async function LegacyMigrationPage() {
  await requireAdminRole();

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
          Legacy token migration
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Migrate csk_v1_ connection tokens to OAuth 2.1 clients. Each
          legacy connection can be replaced by an OAuth client with
          equivalent scopes, then deprecated once the new client is in
          use.
        </p>
      </div>
      <Separator />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
          <MigrationDashboard />
        </div>
      </div>
    </div>
  );
}
