"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdminRoleResult } from "@/server/auth/require_role";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  listRecentDeliveries,
  updateWebhook,
  type ContentWebhook,
  type ContentWebhookDelivery,
} from "@/server/services/content_webhook_service";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Row shape rendered by the admin settings surface. Strips the secret
 * (we never expose it after creation) and attaches delivery metadata.
 */
export interface ContentWebhookRow {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
  last_delivery_at: string | null;
  recent_deliveries: ContentWebhookDelivery[];
}

function stripSecret(wh: ContentWebhook): Omit<ContentWebhook, "secret"> {
  const { secret: _secret, ...rest } = wh;
  void _secret;
  return rest;
}

export async function listContentWebhooksAction(): Promise<ActionResult<ContentWebhookRow[]>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const webhooks = await listWebhooks(supabase, ctx.workspace.id);
    const rows: ContentWebhookRow[] = [];

    for (const wh of webhooks) {
      const deliveries = await listRecentDeliveries(supabase, wh.id, 20);
      rows.push({
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

    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to list webhooks" };
  }
}

export async function createContentWebhookAction(input: {
  name: string;
  url: string;
  eventTypes: string[];
}): Promise<ActionResult<{ webhook: ContentWebhookRow; secret: string }>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const { webhook: created, secret } = await createWebhook(supabase, {
      workspaceId: ctx.workspace.id,
      name: input.name,
      url: input.url,
      eventTypes: input.eventTypes,
      createdBy: ctx.user.id,
    });

    revalidatePath("/app/settings/workspace/webhooks");
    const stripped = stripSecret(created);
    return {
      ok: true,
      data: {
        webhook: {
          id: stripped.id,
          name: stripped.name,
          url: stripped.url,
          event_types: stripped.event_types,
          status: stripped.status,
          created_at: stripped.created_at,
          updated_at: stripped.updated_at,
          last_delivery_at: null,
          recent_deliveries: [],
        },
        secret,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create webhook" };
  }
}

export async function updateContentWebhookAction(
  webhookId: string,
  patch: { name?: string; url?: string; eventTypes?: string[]; status?: "active" | "disabled" },
): Promise<ActionResult<void>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("content_webhooks")
      .select("workspace_id, name")
      .eq("id", webhookId)
      .maybeSingle();
    if (!existing || existing.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Webhook not found" };
    }
    await updateWebhook(supabase, webhookId, patch);
    revalidatePath("/app/settings/workspace/webhooks");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update webhook" };
  }
}

export async function deleteContentWebhookAction(
  webhookId: string,
): Promise<ActionResult<void>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("content_webhooks")
      .select("workspace_id, name")
      .eq("id", webhookId)
      .maybeSingle();
    if (!existing || existing.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Webhook not found" };
    }
    await deleteWebhook(supabase, webhookId);
    revalidatePath("/app/settings/workspace/webhooks");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete webhook" };
  }
}
