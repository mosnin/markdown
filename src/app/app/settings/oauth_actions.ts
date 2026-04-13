"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { revokeConsentTokens } from "@/server/services/oauth_token_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ConnectedAppRow {
  client_id: string;
  client_name: string;
  client_description: string | null;
  is_first_party: boolean;
  workspace_id: string;
  workspace_name: string;
  status: "active" | "revoked";
  scopes: string[];
  granted_at: string;
  last_used_at: string | null;
  active_tokens: number;
}

/**
 * List the OAuth clients the signed-in user has active consents for,
 * across every workspace they can access.
 *
 * Scope data comes from oauth_consents; last-used telemetry from the
 * access_tokens table (max `last_used_at` among live tokens for this
 * consent). A deliberately small projection — we never expose
 * token_hash, token_prefix, client_secret_hash etc.
 */
export async function listConnectedAppsAction(): Promise<ActionResult<ConnectedAppRow[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const { data: consents } = await supabase
      .from("oauth_consents")
      .select("client_id, workspace_id, scopes, created_at, revoked_at")
      .eq("user_id", ctx.user.id);
    if (!consents || consents.length === 0) return { ok: true, data: [] };

    const clientIds = Array.from(new Set(consents.map((c) => c.client_id)));
    const { data: clients } = await supabase
      .from("oauth_clients")
      .select("client_id, name, description, is_first_party")
      .in("client_id", clientIds);
    const clientMap = new Map((clients ?? []).map((c) => [c.client_id, c]));

    const workspaceIds = Array.from(new Set(consents.map((c) => c.workspace_id)));
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id, name")
      .in("id", workspaceIds);
    const workspaceMap = new Map((workspaces ?? []).map((w) => [w.id, w.name]));

    const rows: ConnectedAppRow[] = [];
    for (const c of consents) {
      const client = clientMap.get(c.client_id);
      if (!client) continue;

      const { data: tokens } = await supabase
        .from("oauth_access_tokens")
        .select("last_used_at")
        .eq("user_id", ctx.user.id)
        .eq("client_id", c.client_id)
        .eq("workspace_id", c.workspace_id)
        .is("revoked_at", null);
      const lastUsed = (tokens ?? [])
        .map((t) => t.last_used_at)
        .filter((x): x is string => !!x)
        .sort()
        .pop() ?? null;

      rows.push({
        client_id: c.client_id,
        client_name: client.name,
        client_description: client.description,
        is_first_party: client.is_first_party,
        workspace_id: c.workspace_id,
        workspace_name: workspaceMap.get(c.workspace_id) ?? c.workspace_id,
        status: c.revoked_at ? "revoked" : "active",
        scopes: c.scopes,
        granted_at: c.created_at,
        last_used_at: lastUsed,
        active_tokens: tokens?.length ?? 0,
      });
    }

    rows.sort((a, b) => b.granted_at.localeCompare(a.granted_at));
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to list connected apps" };
  }
}

/**
 * Revoke a user's consent for a single (client, workspace) pair. This
 * revokes every live access + refresh token for that pair in one
 * update, sets the consent's `revoked_at`, and writes an audit event.
 * The connector will get 401 Unauthorized on its next MCP call.
 */
export async function revokeConnectedAppAction(
  clientId: string,
  workspaceId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const admin = createAdminClient();

    await admin
      .from("oauth_consents")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", ctx.user.id)
      .eq("client_id", clientId)
      .eq("workspace_id", workspaceId);

    await revokeConsentTokens(admin, {
      userId: ctx.user.id,
      clientId,
      workspaceId,
    });

    const { data: client } = await admin
      .from("oauth_clients")
      .select("id")
      .eq("client_id", clientId)
      .maybeSingle();

    await createAuditEvent(admin, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "oauth_client",
      object_id: client?.id ?? clientId,
      event_type: "oauth.consent.revoked",
      metadata: { client_id: clientId },
    });

    revalidatePath("/app/settings");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to revoke access" };
  }
}
