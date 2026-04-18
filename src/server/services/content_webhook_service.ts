import { type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "crypto";
import { logger } from "@/lib/logger";

/**
 * Content webhook service.
 *
 * Workspace admins register HTTP endpoints that receive events when
 * notes, links, files, branches, or members change. Each webhook
 * specifies which event types it subscribes to, and outbound requests
 * are signed with HMAC-SHA256 so receivers can verify authenticity.
 *
 * HMAC signing:
 *
 *   Every outbound request carries the header
 *
 *     X-ContextStore-Signature: v1=<hmac-sha256-hex>
 *
 *   where the HMAC is computed over the string
 *
 *     `${timestamp}.${JSON.stringify(body)}`
 *
 *   using the webhook's secret as the key. The timestamp is included in
 *   the body (`body.timestamp`) so receivers can re-compute the
 *   signature deterministically.
 *
 * Delivery model:
 *
 *   - Fire-and-forget from the caller's perspective (dispatchEvent
 *     does not block).
 *   - Each delivery is recorded in content_webhook_deliveries.
 *   - Failed deliveries are retried up to MAX_ATTEMPTS with
 *     exponential backoff via the cron-driven retryFailedDeliveries.
 */

// ─── Supported event types ──────────────────────────────────────────────────

export const SUPPORTED_EVENT_TYPES = [
  "note.created",
  "note.updated",
  "note.trashed",
  "note.archived",
  "file.created",
  "file.updated",
  "link.created",
  "link.deleted",
  "branch.promoted",
  "branch.discarded",
  "member.joined",
] as const;

export type ContentWebhookEventType = (typeof SUPPORTED_EVENT_TYPES)[number];

/** Max delivery attempts before a delivery is permanently marked failed. */
const MAX_ATTEMPTS = 3;

/** Max length of response_body we persist. Protects storage. */
const MAX_RESPONSE_BODY_LEN = 8 * 1024;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ContentWebhook {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  secret: string;
  event_types: string[];
  status: "active" | "disabled";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentWebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "failed";
  response_status: number | null;
  response_body: string | null;
  attempts: number;
  next_retry_at: string | null;
  created_at: string;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createWebhook(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    name: string;
    url: string;
    eventTypes: string[];
    createdBy: string;
  },
): Promise<{ webhook: ContentWebhook; secret: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("Webhook name is required");
  if (name.length > 200) throw new Error("Webhook name must be 200 characters or fewer");

  const url = input.url.trim();
  validateWebhookUrl(url);

  const eventTypes = input.eventTypes.filter((e) =>
    (SUPPORTED_EVENT_TYPES as readonly string[]).includes(e),
  );
  if (eventTypes.length === 0) {
    throw new Error("At least one valid event type is required");
  }

  const secret = generateSecret();

  const { data, error } = await supabase
    .from("content_webhooks")
    .insert({
      workspace_id: input.workspaceId,
      name,
      url,
      secret,
      event_types: eventTypes,
      created_by: input.createdBy,
    })
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create webhook");
  }
  return { webhook: data as ContentWebhook, secret };
}

export async function listWebhooks(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ContentWebhook[]> {
  const { data } = await supabase
    .from("content_webhooks")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ContentWebhook[];
}

export interface UpdateWebhookPatch {
  name?: string;
  url?: string;
  eventTypes?: string[];
  status?: "active" | "disabled";
}

export async function updateWebhook(
  supabase: SupabaseClient,
  webhookId: string,
  patch: UpdateWebhookPatch,
): Promise<ContentWebhook> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error("Webhook name is required");
    if (n.length > 200) throw new Error("Webhook name must be 200 characters or fewer");
    update.name = n;
  }
  if (patch.url !== undefined) {
    validateWebhookUrl(patch.url);
    update.url = patch.url.trim();
  }
  if (patch.eventTypes !== undefined) {
    const filtered = patch.eventTypes.filter((e) =>
      (SUPPORTED_EVENT_TYPES as readonly string[]).includes(e),
    );
    if (filtered.length === 0) {
      throw new Error("At least one valid event type is required");
    }
    update.event_types = filtered;
  }
  if (patch.status !== undefined) {
    update.status = patch.status;
  }
  const { data, error } = await supabase
    .from("content_webhooks")
    .update(update)
    .eq("id", webhookId)
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to update webhook");
  return data as ContentWebhook;
}

export async function deleteWebhook(
  supabase: SupabaseClient,
  webhookId: string,
): Promise<void> {
  const { error } = await supabase
    .from("content_webhooks")
    .delete()
    .eq("id", webhookId);
  if (error) throw new Error(error.message);
}

// ─── Delivery list ──────────────────────────────────────────────────────────

export async function listRecentDeliveries(
  supabase: SupabaseClient,
  webhookId: string,
  limit: number = 20,
): Promise<ContentWebhookDelivery[]> {
  const { data } = await supabase
    .from("content_webhook_deliveries")
    .select("*")
    .eq("webhook_id", webhookId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ContentWebhookDelivery[];
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

/**
 * Fire-and-forget dispatch. Finds all active webhooks for the workspace
 * that match the given event_type, POSTs to each with HMAC signature,
 * and records delivery rows. This function does NOT await the HTTP
 * calls — callers should not block on webhook delivery.
 */
export function dispatchEvent(
  supabase: SupabaseClient,
  workspaceId: string,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  // Fire-and-forget: kick off async work without blocking the caller.
  void dispatchEventAsync(supabase, workspaceId, eventType, payload);
}

async function dispatchEventAsync(
  supabase: SupabaseClient,
  workspaceId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: webhooks } = await supabase
      .from("content_webhooks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .contains("event_types", [eventType]);
    if (!webhooks || webhooks.length === 0) return;

    const timestamp = new Date().toISOString();
    const body = { event_type: eventType, timestamp, payload };
    const bodyJson = JSON.stringify(body);

    await Promise.allSettled(
      (webhooks as ContentWebhook[]).map((wh) =>
        deliverWebhook(supabase, wh, eventType, bodyJson, timestamp, body),
      ),
    );
  } catch (err) {
    logger.error(
      { workspaceId, eventType, err: err instanceof Error ? err.message : String(err) },
      "content webhook dispatch error",
    );
  }
}

async function deliverWebhook(
  supabase: SupabaseClient,
  webhook: ContentWebhook,
  eventType: string,
  bodyJson: string,
  timestamp: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // Create a delivery row first so we always have a trace.
  const { data: deliveryRow } = await supabase
    .from("content_webhook_deliveries")
    .insert({
      webhook_id: webhook.id,
      event_type: eventType,
      payload,
      status: "pending",
      attempts: 1,
    })
    .select()
    .single();
  const deliveryId = (deliveryRow as ContentWebhookDelivery | null)?.id;

  const signature = signBody(webhook.secret, timestamp, bodyJson);

  let status: "delivered" | "failed" = "failed";
  let responseStatus: number | null = null;
  let responseBody: string | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-ContextStore-Signature": `v1=${signature}`,
          "X-ContextStore-Timestamp": timestamp,
        },
        body: bodyJson,
      });
      responseStatus = res.status;
      const rawText = await res.text();
      responseBody =
        rawText.length > MAX_RESPONSE_BODY_LEN
          ? rawText.slice(0, MAX_RESPONSE_BODY_LEN)
          : rawText;

      if (res.ok) {
        status = "delivered";
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    responseBody = err instanceof Error ? err.message : String(err);
  }

  if (deliveryId) {
    const update: Record<string, unknown> = {
      status,
      response_status: responseStatus,
      response_body: responseBody,
      attempts: 1,
    };
    if (status === "failed") {
      // Schedule first retry with exponential backoff (base 30s).
      update.next_retry_at = new Date(Date.now() + 30_000).toISOString();
    }
    await supabase
      .from("content_webhook_deliveries")
      .update(update)
      .eq("id", deliveryId);
  }

  logger.info(
    { webhookId: webhook.id, eventType, status, responseStatus },
    "content webhook delivery",
  );
}

// ─── Retry ──────────────────────────────────────────────────────────────────

/**
 * Retry pending deliveries that are due. Called by the cron endpoint.
 * Respects MAX_ATTEMPTS — deliveries that have exhausted retries are
 * permanently marked 'failed'.
 */
export async function retryFailedDeliveries(
  supabase: SupabaseClient,
): Promise<{ retried: number; permanentlyFailed: number }> {
  const now = new Date().toISOString();
  const { data: pending } = await supabase
    .from("content_webhook_deliveries")
    .select("*, content_webhooks!inner(id, url, secret, status)")
    .eq("status", "pending")
    .lte("next_retry_at", now)
    .limit(100);

  let retried = 0;
  let permanentlyFailed = 0;

  for (const row of (pending ?? []) as Array<
    ContentWebhookDelivery & {
      content_webhooks: Pick<ContentWebhook, "id" | "url" | "secret" | "status">;
    }
  >) {
    const wh = row.content_webhooks;
    const newAttempt = row.attempts + 1;

    if (newAttempt > MAX_ATTEMPTS || wh.status === "disabled") {
      // Max attempts exhausted or webhook disabled — permanently fail.
      await supabase
        .from("content_webhook_deliveries")
        .update({ status: "failed", attempts: newAttempt, next_retry_at: null })
        .eq("id", row.id);
      permanentlyFailed++;
      continue;
    }

    const timestamp = new Date().toISOString();
    const bodyJson = JSON.stringify({
      event_type: row.event_type,
      timestamp,
      payload: row.payload,
    });
    const signature = signBody(wh.secret, timestamp, bodyJson);

    let status: "delivered" | "pending" = "pending";
    let responseStatus: number | null = null;
    let responseBody: string | null = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(wh.url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-ContextStore-Signature": `v1=${signature}`,
            "X-ContextStore-Timestamp": timestamp,
          },
          body: bodyJson,
        });
        responseStatus = res.status;
        const rawText = await res.text();
        responseBody =
          rawText.length > MAX_RESPONSE_BODY_LEN
            ? rawText.slice(0, MAX_RESPONSE_BODY_LEN)
            : rawText;
        if (res.ok) {
          status = "delivered";
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      responseBody = err instanceof Error ? err.message : String(err);
    }

    const update: Record<string, unknown> = {
      status: status === "delivered" ? "delivered" : "pending",
      response_status: responseStatus,
      response_body: responseBody,
      attempts: newAttempt,
    };

    if (status !== "delivered") {
      if (newAttempt >= MAX_ATTEMPTS) {
        update.status = "failed";
        update.next_retry_at = null;
        permanentlyFailed++;
      } else {
        // Exponential backoff: 30s, 120s, 480s, ...
        const backoffMs = 30_000 * Math.pow(4, newAttempt - 1);
        update.next_retry_at = new Date(Date.now() + backoffMs).toISOString();
      }
    } else {
      update.next_retry_at = null;
      retried++;
    }

    await supabase
      .from("content_webhook_deliveries")
      .update(update)
      .eq("id", row.id);
  }

  return { retried, permanentlyFailed };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate a 32-byte random secret, hex-encoded (64 chars). */
export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * HMAC-SHA256 signature over `${timestamp}.${bodyJson}` using the
 * webhook's secret.
 */
export function signBody(secret: string, timestamp: string, bodyJson: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${bodyJson}`)
    .digest("hex");
}

/**
 * Enforce https-only webhook URLs and reject obvious SSRF targets.
 */
function validateWebhookUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Webhook URL is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Webhook URL must use https://");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    throw new Error("Webhook URL cannot point at loopback");
  }
}
