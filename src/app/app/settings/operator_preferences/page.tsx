import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getNotificationPrefs } from "@/server/services/operator_notifications_service";
import { listApiKeysForUser } from "@/server/services/operator_api_keys_service";
import { OperatorNotificationPrefsCard } from "@/components/product/operator/operator_notification_prefs";
import { OperatorApiKeysManager } from "@/components/product/operator/operator_api_keys_manager";
import { PageHeader } from "@/components/product/page_header";

/**
 * Operator preferences settings page.
 *
 * Two cards under the existing settings shell:
 *   1. Notification preferences (email on complete / fail)
 *   2. REST API keys management
 *
 * Both cards are seeded server-side with the user's current state so
 * the first paint shows real data, not a spinner.
 */
export default async function OperatorPreferencesPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  // Both reads tolerate "no row yet" — getNotificationPrefs returns the
  // system defaults, listApiKeysForUser returns an empty list. We don't
  // need to handle errors here; render falls through to the cards
  // which surface their own errors on save.
  const [prefs, keys] = await Promise.all([
    getNotificationPrefs(supabase, ctx.user.id),
    listApiKeysForUser(supabase, ctx.user.id).catch(() => []),
  ]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Operator preferences"
        description="Notification preferences and REST API keys for the Workspace Operator."
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
          <OperatorNotificationPrefsCard initialPrefs={prefs} />
          <OperatorApiKeysManager initialKeys={keys} />
        </div>
      </div>
    </div>
  );
}
