"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminRoleResult } from "@/server/auth/require_role";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import type { PermissionMode } from "@/server/domain/constants/connection_constants";

// ─── Action result ────────────────────────────────────────────────────────────

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LegacyConnectionRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  permission_mode: PermissionMode;
  last_used_at: string | null;
  created_at: string;
  deprecated_at: string | null;
  token_count: number;
  /** Whether a matching OAuth client exists (name match). */
  has_oauth_match: boolean;
  /** The matching OAuth client_id, if any. */
  matched_oauth_client_id: string | null;
  /** The matching OAuth client name, if any. */
  matched_oauth_client_name: string | null;
}

// ─── listLegacyConnectionsAction ──────────────────────────────────────────────

/**
 * Admin-only. Lists all legacy connections in the workspace with their
 * token counts and whether a matching OAuth client exists.
 */
export async function listLegacyConnectionsAction(): Promise<
  ActionResult<LegacyConnectionRow[]>
> {
  const check = await requireAdminRoleResult();
  if (!check.ok) return { ok: false, error: check.error };
  const { ctx } = check;

  try {
    const admin = createAdminClient();

    // Fetch connections for this workspace (include all statuses for
    // migration visibility).
    const { data: connections, error: connErr } = await admin
      .from("connections")
      .select(
        "id, name, description, status, permission_mode, last_used_at, created_at, deprecated_at"
      )
      .eq("workspace_id", ctx.workspace.id)
      .order("created_at", { ascending: true });

    if (connErr) {
      return { ok: false, error: connErr.message };
    }
    if (!connections || connections.length === 0) {
      return { ok: true, data: [] };
    }

    // Count active tokens per connection.
    const connectionIds = connections.map((c) => c.id);
    const { data: tokens } = await admin
      .from("connection_tokens")
      .select("connection_id, status")
      .in("connection_id", connectionIds)
      .eq("status", "active");

    const tokenCounts = new Map<string, number>();
    for (const t of tokens ?? []) {
      tokenCounts.set(
        t.connection_id,
        (tokenCounts.get(t.connection_id) ?? 0) + 1
      );
    }

    // Fetch all active OAuth clients in the workspace (created by any
    // user) to check for name-based matches.
    const { data: oauthClients } = await admin
      .from("oauth_clients")
      .select("client_id, name")
      .eq("status", "active");

    // Build a name-based lookup (case-insensitive).
    const oauthByName = new Map<string, { client_id: string; name: string }>();
    for (const oc of oauthClients ?? []) {
      oauthByName.set(oc.name.toLowerCase().trim(), {
        client_id: oc.client_id,
        name: oc.name,
      });
    }

    const rows: LegacyConnectionRow[] = connections.map((c) => {
      const match = oauthByName.get(c.name.toLowerCase().trim()) ?? null;
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        status: c.status,
        permission_mode: c.permission_mode as PermissionMode,
        last_used_at: c.last_used_at,
        created_at: c.created_at,
        deprecated_at: c.deprecated_at ?? null,
        token_count: tokenCounts.get(c.id) ?? 0,
        has_oauth_match: !!match,
        matched_oauth_client_id: match?.client_id ?? null,
        matched_oauth_client_name: match?.name ?? null,
      };
    });

    return { ok: true, data: rows };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to list connections",
    };
  }
}

// ─── deprecateLegacyConnectionAction ──────────────────────────────────────────

/**
 * Admin-only. Sets deprecated_at on a single legacy connection.
 */
export async function deprecateLegacyConnectionAction(
  connectionId: string
): Promise<ActionResult> {
  const check = await requireAdminRoleResult();
  if (!check.ok) return { ok: false, error: check.error };
  const { ctx } = check;

  try {
    const admin = createAdminClient();

    // Verify the connection belongs to the workspace.
    const { data: conn } = await admin
      .from("connections")
      .select("id, workspace_id, name, deprecated_at")
      .eq("id", connectionId)
      .maybeSingle();

    if (!conn) return { ok: false, error: "Connection not found." };
    if (conn.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Connection not found." };
    }
    if (conn.deprecated_at) {
      return { ok: false, error: "Connection is already deprecated." };
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("connections")
      .update({ deprecated_at: now })
      .eq("id", connectionId);

    if (updateErr) {
      return { ok: false, error: updateErr.message };
    }

    await createAuditEvent(admin, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "connection",
      object_id: connectionId,
      event_type: "connection.deprecated",
      metadata: { name: conn.name },
    });

    revalidatePath("/app/settings/connections/migration");
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to deprecate connection",
    };
  }
}

// ─── bulkDeprecateMigratedAction ──────────────────────────────────────────────

/**
 * Admin-only. Stamps deprecated_at on every connection that has a
 * matching OAuth client (by name) and is not already deprecated.
 */
export async function bulkDeprecateMigratedAction(): Promise<
  ActionResult<{ count: number }>
> {
  const check = await requireAdminRoleResult();
  if (!check.ok) return { ok: false, error: check.error };
  const { ctx } = check;

  try {
    const admin = createAdminClient();

    // Use the list action's logic to identify migrated connections.
    const listResult = await listLegacyConnectionsAction();
    if (!listResult.ok) return { ok: false, error: listResult.error };

    const toDeprecate = listResult.data.filter(
      (c) => c.has_oauth_match && !c.deprecated_at
    );

    if (toDeprecate.length === 0) {
      return { ok: true, data: { count: 0 } };
    }

    const now = new Date().toISOString();
    const ids = toDeprecate.map((c) => c.id);

    const { error: updateErr } = await admin
      .from("connections")
      .update({ deprecated_at: now })
      .in("id", ids);

    if (updateErr) {
      return { ok: false, error: updateErr.message };
    }

    // Audit each deprecation.
    await Promise.all(
      toDeprecate.map((c) =>
        createAuditEvent(admin, {
          workspace_id: ctx.workspace.id,
          actor_type: "user",
          actor_id: ctx.user.id,
          object_type: "connection",
          object_id: c.id,
          event_type: "connection.deprecated",
          metadata: { name: c.name, bulk: true },
        })
      )
    );

    revalidatePath("/app/settings/connections/migration");
    return { ok: true, data: { count: toDeprecate.length } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to bulk-deprecate connections",
    };
  }
}
