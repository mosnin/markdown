"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWriteRole } from "@/server/auth/require_role";
import { revokeAllTokensForConsent } from "@/server/services/oauth_token_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ConnectedAppDetail {
  consent_id: string;
  client_id: string;
  client_name: string;
  client_description: string | null;
  logo_url: string | null;
  homepage_url: string | null;
  is_first_party: boolean;
  workspace_id: string;
  workspace_name: string;
  scopes: string[];
  granted_at: string;
  last_used_at: string | null;
  active_token_count: number;
  status: "active" | "revoked";
}

/**
 * List every OAuth consent the caller owns, across every workspace
 * they can see. Uses the caller's RLS-bound supabase client so we
 * never leak consents belonging to a different user.
 *
 * For each consent we aggregate `last_used_at` from its live access
 * tokens (max across non-revoked rows) and attach the workspace name
 * for display. Revoked consents are included so the user can see a
 * full audit log without surprises; they are visually de-emphasized
 * in the UI.
 */
export async function listConnectedAppsDetailAction(): Promise<ActionResult<ConnectedAppDetail[]>> {
  try {
    const ctx = await requireWriteRole();
    const supabase = await createClient();

    const { data: consents, error } = await supabase
      .from("oauth_consents")
      .select("id, client_id, workspace_id, scopes, created_at, revoked_at")
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    if (!consents || consents.length === 0) return { ok: true, data: [] };

    const clientIds = Array.from(new Set(consents.map((c) => c.client_id)));
    const workspaceIds = Array.from(new Set(consents.map((c) => c.workspace_id)));

    const [{ data: clients }, { data: workspaces }] = await Promise.all([
      supabase
        .from("oauth_clients")
        .select("client_id, name, description, logo_url, homepage_url, is_first_party")
        .in("client_id", clientIds),
      supabase
        .from("workspaces")
        .select("id, name")
        .in("id", workspaceIds),
    ]);
    const clientMap = new Map((clients ?? []).map((c) => [c.client_id, c]));
    const workspaceMap = new Map((workspaces ?? []).map((w) => [w.id, w.name]));

    const results: ConnectedAppDetail[] = [];
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
      const lastUsed =
        (tokens ?? [])
          .map((t) => t.last_used_at)
          .filter((x): x is string => !!x)
          .sort()
          .pop() ?? null;
      results.push({
        consent_id: c.id,
        client_id: c.client_id,
        client_name: client.name,
        client_description: client.description,
        logo_url: client.logo_url,
        homepage_url: client.homepage_url,
        is_first_party: client.is_first_party,
        workspace_id: c.workspace_id,
        workspace_name: workspaceMap.get(c.workspace_id) ?? "Workspace",
        scopes: c.scopes ?? [],
        granted_at: c.created_at,
        last_used_at: lastUsed,
        active_token_count: tokens?.length ?? 0,
        status: c.revoked_at ? "revoked" : "active",
      });
    }
    return { ok: true, data: results };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list connected apps",
    };
  }
}

/**
 * Revoke every live access + refresh token for a consent, and stamp
 * the consent itself as revoked. The caller must own the consent
 * (consent.user_id === caller) and hold a write-capable role on the
 * workspace the consent targets.
 *
 * Wraps the backend-owned `revokeAllTokensForConsent(consentId)`
 * service function. Returns the number of tokens that were revoked
 * so the UI can render a "X tokens revoked" toast.
 */
export async function revokeConnectedAppByConsentAction(
  consentId: string
): Promise<ActionResult<{ tokens_revoked: number }>> {
  try {
    const ctx = await requireWriteRole();
    const admin = createAdminClient();

    // Load the consent first so we can verify ownership and capture
    // the pre-revoke token count for the response message.
    const { data: consent } = await admin
      .from("oauth_consents")
      .select("id, user_id, client_id, workspace_id, revoked_at")
      .eq("id", consentId)
      .maybeSingle();
    if (!consent) return { ok: false, error: "Grant not found." };
    if (consent.user_id !== ctx.user.id) {
      return { ok: false, error: "You do not own this grant." };
    }
    if (consent.revoked_at) {
      return { ok: true, data: { tokens_revoked: 0 } };
    }

    const { count: liveTokens } = await admin
      .from("oauth_access_tokens")
      .select("id", { count: "exact", head: true })
      .eq("user_id", consent.user_id)
      .eq("client_id", consent.client_id)
      .eq("workspace_id", consent.workspace_id)
      .is("revoked_at", null);

    await revokeAllTokensForConsent(admin, consentId);

    const { data: clientRow } = await admin
      .from("oauth_clients")
      .select("id")
      .eq("client_id", consent.client_id)
      .maybeSingle();

    await createAuditEvent(admin, {
      workspace_id: consent.workspace_id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "oauth_client",
      object_id: clientRow?.id ?? consent.client_id,
      event_type: "oauth.consent.revoked",
      metadata: {
        client_id: consent.client_id,
        consent_id: consent.id,
        tokens_revoked: liveTokens ?? 0,
      },
    });

    revalidatePath("/app/settings/connected_apps");
    revalidatePath("/app/settings");
    return { ok: true, data: { tokens_revoked: liveTokens ?? 0 } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Revoke failed",
    };
  }
}
