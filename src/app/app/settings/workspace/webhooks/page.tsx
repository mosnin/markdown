import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { canAdmin } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import { listWebhooks, listRecentDeliveries } from "@/server/services/content_webhook_service";
import { Separator } from "@/components/ui/separator";
import { ContentWebhooksManager } from "./webhooks_manager";
import type { ContentWebhookRow } from "./actions";

/**
 * Workspace admin surface for content change webhooks.
 *
 * Admins register HTTP endpoints that receive events when notes, links,
 * files, branches, or members change. Signing secrets are shown once on
 * creation — store them somewhere safe before closing the dialog.
 */
export default async function ContentWebhooksPage() {
  const ctx = await requireAuthenticatedUser();

  if (!canAdmin(ctx.workspace.role)) {
    redirect("/app");
  }

  const supabase = await createClient();
  const webhooks = await listWebhooks(supabase, ctx.workspace.id);

  const initialRows: ContentWebhookRow[] = [];
  for (const wh of webhooks) {
    const deliveries = await listRecentDeliveries(supabase, wh.id, 20);
    initialRows.push({
      id: wh.id,
      name: wh.name,
      url: wh.url,
      event_types: wh.event_types,
      status: wh.status,
      created_at: wh.created_at,
      updated_at: wh.updated_at,
      last_delivery_at: deliveries.length > 0 ? deliveries[0].created_at : null,
      recent_deliveries: deliveries,
    });
  }

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
          Content webhooks
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          HTTP endpoints that receive events when notes, links, files,
          branches, or members change. Signing secrets are shown once on
          creation — store them somewhere safe before closing the dialog.
        </p>
      </div>
      <Separator />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          <ContentWebhooksManager initialWebhooks={initialRows} />
        </div>
      </div>
    </div>
  );
}
