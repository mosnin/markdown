"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWriteRole } from "@/server/auth/require_role";
import {
  deprecateClient,
  listClientsForOwner,
  updateClient,
  type OAuthClient,
} from "@/server/services/oauth_client_service";
import {
  ALL_SCOPES,
  type OAuthCapabilityScope,
} from "@/server/services/oauth_scope_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Row shape rendered by the /app/settings/oauth_clients page. Extends
 * the raw `OAuthClient` with `last_used_at` aggregated from the
 * client's live access tokens (max `last_used_at` across every
 * non-revoked token). The aggregation is O(tokens_per_client) — small
 * for a UI that typically shows a handful of clients.
 */
export interface OauthClientRow extends OAuthClient {
  last_used_at: string | null;
  active_token_count: number;
  active_consent_count: number;
}

/**
 * List every client the caller owns (created_by = caller) plus
 * aggregated telemetry used by the management table.
 *
 * Ownership model: ONLY clients the caller created appear in the
 * returned rows — first-party seeded clients are intentionally
 * excluded because they are managed by platform admins, not by
 * end users. Workspace admins do not see other users' clients from
 * this surface; per-user isolation is the cleanest default and
 * matches `listClientsForOwner()`.
 */
export async function listOauthClientRowsAction(): Promise<ActionResult<OauthClientRow[]>> {
  try {
    const ctx = await requireWriteRole();
    const admin = createAdminClient();
    const clients = await listClientsForOwner(admin, ctx.user.id);

    if (clients.length === 0) return { ok: true, data: [] };

    const clientIds = clients.map((c) => c.client_id);

    // Aggregate last-used + active-token count in a single query per
    // list-view. Counts are best-effort for a UX readout, not a
    // security-sensitive value.
    const { data: tokens } = await admin
      .from("oauth_access_tokens")
      .select("client_id, last_used_at")
      .in("client_id", clientIds)
      .is("revoked_at", null);
    const tokenStats = new Map<string, { last_used_at: string | null; count: number }>();
    for (const t of tokens ?? []) {
      const cur = tokenStats.get(t.client_id) ?? { last_used_at: null, count: 0 };
      cur.count += 1;
      if (t.last_used_at && (!cur.last_used_at || t.last_used_at > cur.last_used_at)) {
        cur.last_used_at = t.last_used_at;
      }
      tokenStats.set(t.client_id, cur);
    }

    const { data: consents } = await admin
      .from("oauth_consents")
      .select("client_id")
      .in("client_id", clientIds)
      .is("revoked_at", null);
    const consentCount = new Map<string, number>();
    for (const c of consents ?? []) {
      consentCount.set(c.client_id, (consentCount.get(c.client_id) ?? 0) + 1);
    }

    const rows: OauthClientRow[] = clients.map((c) => ({
      ...c,
      last_used_at: tokenStats.get(c.client_id)?.last_used_at ?? null,
      active_token_count: tokenStats.get(c.client_id)?.count ?? 0,
      active_consent_count: consentCount.get(c.client_id) ?? 0,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list clients",
    };
  }
}

/**
 * Patch an OAuth client's metadata. Only the caller that registered
 * the client (created_by === caller) may update it. First-party
 * clients are never mutable through this surface.
 */
export async function updateOauthClientAction(
  clientId: string,
  patch: {
    name?: string;
    description?: string | null;
    homepage_url?: string | null;
    redirect_uris?: string[];
    allowed_scopes?: OAuthCapabilityScope[];
  }
): Promise<ActionResult<OAuthClient>> {
  try {
    const ctx = await requireWriteRole();
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("oauth_clients")
      .select("id, created_by, is_first_party")
      .eq("client_id", clientId)
      .maybeSingle();
    if (!existing) return { ok: false, error: "Client not found" };
    if (existing.is_first_party) {
      return {
        ok: false,
        error: "First-party clients cannot be edited here.",
      };
    }
    if (existing.created_by !== ctx.user.id) {
      return {
        ok: false,
        error: "You did not register this client.",
      };
    }

    // Validate redirect URIs — non-OOB values must be absolute URLs.
    if (patch.redirect_uris) {
      if (patch.redirect_uris.length === 0) {
        return { ok: false, error: "At least one redirect URI is required." };
      }
      for (const uri of patch.redirect_uris) {
        if (uri === "urn:ietf:wg:oauth:2.0:oob") continue;
        try {
          new URL(uri);
        } catch {
          return { ok: false, error: `Invalid redirect URI: ${uri}` };
        }
      }
    }

    // Filter scopes to known capability scopes only.
    if (patch.allowed_scopes) {
      const valid = patch.allowed_scopes.filter((s): s is OAuthCapabilityScope =>
        (ALL_SCOPES as readonly string[]).includes(s)
      );
      if (valid.length === 0) {
        return { ok: false, error: "At least one valid scope is required." };
      }
      patch.allowed_scopes = valid;
    }

    const updated = await updateClient(admin, clientId, patch);
    if (!updated) return { ok: false, error: "Update failed." };

    await createAuditEvent(admin, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "oauth_client",
      object_id: existing.id,
      event_type: "oauth.client.updated",
      metadata: { client_id: clientId, fields: Object.keys(patch) },
    });

    revalidatePath("/app/settings/oauth_clients");
    return { ok: true, data: updated };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed",
    };
  }
}

/**
 * Deprecate (not delete) a client. Surfaces deprecation to the UI so
 * downstream connectors can migrate away before the client is actually
 * suspended. Because the baseline schema does not yet include a
 * `deprecated_at` column, we tag deprecation by flipping `status` to
 * `suspended` via `updateClient` — the backend agent owns adding a
 * dedicated column + the `deprecateClient()` write path that targets
 * it. Either way, the UX semantic (the client can no longer complete
 * authorize flows) is preserved.
 *
 * Deprecation does NOT revoke active consents or tokens by itself;
 * users that still want to stop existing sessions do that via the
 * Connected Apps surface.
 */
export async function deprecateOauthClientAction(
  clientId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireWriteRole();
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("oauth_clients")
      .select("id, created_by, is_first_party, status")
      .eq("client_id", clientId)
      .maybeSingle();
    if (!existing) return { ok: false, error: "Client not found" };
    if (existing.is_first_party) {
      return {
        ok: false,
        error: "First-party clients cannot be deprecated here.",
      };
    }
    if (existing.created_by !== ctx.user.id) {
      return { ok: false, error: "You did not register this client." };
    }

    // Attempt the dedicated service path first (writes deprecated_at
    // when the column exists); fall back to status=suspended.
    let deprecated = false;
    try {
      const result = await deprecateClient(admin, clientId);
      if (result) deprecated = true;
    } catch {
      // Ignore; fall back to status flip below.
    }
    if (!deprecated) {
      await updateClient(admin, clientId, { status: "suspended" });
    }

    await createAuditEvent(admin, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "oauth_client",
      object_id: existing.id,
      event_type: "oauth.client.deprecated",
      metadata: { client_id: clientId },
    });

    revalidatePath("/app/settings/oauth_clients");
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Deprecate failed",
    };
  }
}
