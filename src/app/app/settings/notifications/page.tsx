import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getNotificationPreferences } from "@/server/services/activity_feed_service";
import { Separator } from "@/components/ui/separator";
import { NotificationPreferencesClient } from "./notification_preferences_client";

/**
 * Notification preferences page.
 *
 * Lets the user toggle which event categories show up in their
 * activity feed and (eventually) email digest frequency.
 */
export default async function NotificationPreferencesPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const prefs = await getNotificationPreferences(
    supabase,
    ctx.user.id,
    ctx.workspace.id
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <div className="bg-background">
        <div className="px-6 pt-6 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Notification Preferences
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose which events appear in your activity feed.
          </p>
        </div>
        <Separator />
      </div>

      {/* Preferences form */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <NotificationPreferencesClient
            initialPrefs={{
              note_created: prefs.note_created,
              note_updated: prefs.note_updated,
              link_created: prefs.link_created,
              branch_promoted: prefs.branch_promoted,
              member_joined: prefs.member_joined,
              proposal_submitted: prefs.proposal_submitted,
              email_digest: prefs.email_digest,
            }}
          />
        </div>
      </div>
    </div>
  );
}
