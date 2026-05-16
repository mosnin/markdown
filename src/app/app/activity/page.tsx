import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getActivityFeed, getUnreadCount, markAsRead } from "@/server/services/activity_feed_service";
import { Separator } from "@/components/ui/separator";
import { ActivityFeedClient } from "./activity_feed_client";
import { PageTransition } from "@/components/product/page_transition";

/**
 * Activity feed page.
 *
 * Shows a personalized stream of workspace events filtered by the
 * user's notification preferences. Marks the feed as read on page
 * load so the unread badge clears.
 */
export default async function ActivityPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const [feedResult] = await Promise.all([
    getActivityFeed(supabase, ctx.workspace.id, ctx.user.id, { limit: 30 }),
    // Mark as read when the page loads
    markAsRead(supabase, ctx.workspace.id, ctx.user.id),
  ]);

  return (
    <PageTransition className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <div className="bg-background">
        <div className="px-6 pt-6 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Activity
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What happened in your workspace while you were away.
          </p>
        </div>
        <Separator />
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-hidden">
        <ActivityFeedClient
          initialItems={feedResult.items}
          initialHasMore={feedResult.has_more}
        />
      </div>
    </PageTransition>
  );
}
