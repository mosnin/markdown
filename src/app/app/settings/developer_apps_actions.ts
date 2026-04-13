"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { registerClient, rotateClientSecret } from "@/server/services/oauth_client_service";
import { ALL_SCOPES, type OAuthScope } from "@/server/services/oauth_scope_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface DeveloperAppRow {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  is_confidential: boolean;
  is_first_party: boolean;
  status: "active" | "suspended" | "deleted";
  redirect_uris: string[];
  allowed_scopes: string[];
  created_at: string;
  created_by: string | null;
  last_used_at: string | null;
  active_tokens: number;
}

export interface NewlyRegisteredApp {
  client: DeveloperAppRow;
  /** Only returned once, at registration time. */
  client_secret?: string;
}

/**
 * List OAuth clients the signed-in user registered (created_by).
 * First-party seeded clients are included for visibility but are
 * marked read-only on the UI.
 */
export async function listDeveloperAppsAction(): Promise<ActionResult<DeveloperAppRow[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("oauth_clients")
      .select("id, client_id, name, description, is_confidential, is_first_party, status, redirect_uris, allowed_scopes, created_at, created_by")
      .or(`created_by.eq.${ctx.user.id},is_first_party.eq.true`)
      .neq("status", "deleted")
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: error.message };

    const rows = ((data ?? []) as Omit<DeveloperAppRow, "last_used_at" | "active_tokens">[]);
    const clientIds = rows.map((r) => r.client_id);
    const tokenStats = new Map<string, { active: number; lastUsedAt: string | null }>();
    if (clientIds.length > 0) {
      const { data: tokenRows } = await admin
        .from("oauth_access_tokens")
        .select("client_id, last_used_at")
        .in("client_id", clientIds)
        .is("revoked_at", null);
      for (const t of tokenRows ?? []) {
        const prev = tokenStats.get(t.client_id) ?? { active: 0, lastUsedAt: null };
        const lastUsedAt =
          t.last_used_at && (!prev.lastUsedAt || t.last_used_at > prev.lastUsedAt)
            ? t.last_used_at
            : prev.lastUsedAt;
        tokenStats.set(t.client_id, {
          active: prev.active + 1,
          lastUsedAt,
        });
      }
    }

    const enriched: DeveloperAppRow[] = [];
    for (const row of rows) {
      const stats = tokenStats.get(row.client_id);
      enriched.push({
        ...row,
        name: row.name ?? "Unnamed app",
        description: row.description ?? null,
        redirect_uris: Array.isArray(row.redirect_uris) ? row.redirect_uris : [],
        allowed_scopes: Array.isArray(row.allowed_scopes) ? row.allowed_scopes : [],
        is_confidential: Boolean(row.is_confidential),
        is_first_party: Boolean(row.is_first_party),
        last_used_at: stats?.lastUsedAt ?? null,
        active_tokens: stats?.active ?? 0,
      });
    }

    return { ok: true, data: enriched };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to list apps" };
  }
}

export async function registerDeveloperAppAction(input: {
  name: string;
  description?: string | null;
  homepage_url?: string | null;
  redirect_uris: string[];
  scopes: OAuthScope[];
  is_confidential: boolean;
}): Promise<ActionResult<NewlyRegisteredApp>> {
  try {
    const ctx = await requireAuthenticatedUser();

    const name = input.name.trim();
    if (!name) return { ok: false, error: "Name is required" };
    if (input.redirect_uris.length === 0) {
      return { ok: false, error: "At least one redirect URI is required" };
    }
    for (const uri of input.redirect_uris) {
      if (uri === "urn:ietf:wg:oauth:2.0:oob") continue;
      try {
        new URL(uri);
      } catch {
        return { ok: false, error: `Invalid redirect URI: ${uri}` };
      }
    }
    const scopes = input.scopes.filter((s): s is OAuthScope =>
      (ALL_SCOPES as readonly string[]).includes(s)
    );
    if (scopes.length === 0) {
      return { ok: false, error: "At least one valid scope is required" };
    }

    const admin = createAdminClient();
    const registered = await registerClient(admin, {
      name,
      description: input.description ?? null,
      homepage_url: input.homepage_url ?? null,
      redirect_uris: input.redirect_uris,
      allowed_scopes: scopes,
      is_confidential: input.is_confidential,
      is_first_party: false,
      created_by: ctx.user.id,
    });

    await createAuditEvent(admin, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "oauth_client",
      object_id: registered.client.id,
      event_type: "oauth.client.registered",
      metadata: {
        client_id: registered.client.client_id,
        is_confidential: input.is_confidential,
        allowed_scopes: scopes,
      },
    });

    revalidatePath("/app/settings");

    return {
      ok: true,
      data: {
        client: { ...registered.client, last_used_at: null, active_tokens: 0 } as DeveloperAppRow,
        client_secret: registered.client_secret,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Registration failed" };
  }
}

/**
 * Rotate a confidential client's secret. Only the developer who
 * registered the client can rotate it. Live access + refresh tokens
 * are NOT revoked by rotation — existing sessions keep working until
 * they naturally expire or are explicitly revoked. Rotation only
 * invalidates the OLD secret so new token-endpoint calls must present
 * the new one.
 */
export async function rotateDeveloperAppSecretAction(
  clientId: string
): Promise<ActionResult<{ client_secret: string }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const admin = createAdminClient();
    const { data: client } = await admin
      .from("oauth_clients")
      .select("id, created_by, is_first_party, is_confidential, status")
      .eq("client_id", clientId)
      .maybeSingle();
    if (!client) return { ok: false, error: "Client not found" };
    if (client.is_first_party) {
      return { ok: false, error: "First-party client secrets cannot be rotated from this surface" };
    }
    if (client.created_by !== ctx.user.id) {
      return { ok: false, error: "You did not register this client" };
    }
    if (!client.is_confidential) {
      return { ok: false, error: "Public clients have no secret to rotate" };
    }

    const secret = await rotateClientSecret(admin, clientId);
    if (!secret) return { ok: false, error: "Failed to rotate secret" };

    await createAuditEvent(admin, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "oauth_client",
      object_id: client.id,
      event_type: "oauth.client.secret_rotated",
      metadata: { client_id: clientId },
    });

    revalidatePath("/app/settings");
    return { ok: true, data: { client_secret: secret } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Rotate failed" };
  }
}

/**
 * Soft-delete a developer's own client. First-party and other users'
 * clients cannot be deleted through this surface.
 */
export async function deleteDeveloperAppAction(
  clientId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const admin = createAdminClient();
    const { data: client } = await admin
      .from("oauth_clients")
      .select("id, created_by, is_first_party")
      .eq("client_id", clientId)
      .maybeSingle();
    if (!client) return { ok: false, error: "Client not found" };
    if (client.is_first_party) {
      return { ok: false, error: "First-party clients cannot be deleted" };
    }
    if (client.created_by !== ctx.user.id) {
      return { ok: false, error: "You did not register this client" };
    }

    // Revoke every live token for this client across all users +
    // workspaces so the delete is immediate rather than cosmetic.
    await admin
      .from("oauth_access_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .is("revoked_at", null);
    await admin
      .from("oauth_refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .is("revoked_at", null);

    await admin
      .from("oauth_clients")
      .update({ status: "deleted" })
      .eq("client_id", clientId);

    await createAuditEvent(admin, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "oauth_client",
      object_id: client.id,
      event_type: "oauth.client.deleted",
      metadata: { client_id: clientId },
    });

    revalidatePath("/app/settings");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed" };
  }
}
