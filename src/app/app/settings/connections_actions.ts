"use server";

import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  createConnection,
  rotateConnectionToken,
  revokeConnection,
  updateConnectionMeta,
  addConnectionBoxScope,
  removeConnectionBoxScope,
  listConnectionsWithScopes,
} from "@/server/services/connection_service";
import {
  type ConnectionType,
  type PermissionMode,
} from "@/server/domain/constants/connection_constants";
import {
  type Connection,
  type ConnectionBoxScope,
} from "@/server/domain/types/connection";

// ─── Action result ────────────────────────────────────────────────────────────

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireContext() {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    throw new Error("Unauthenticated");
  }
  const supabase = await createClient();
  return { supabase, userId: ctx.user.id, workspaceId: ctx.workspace.id };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export type ConnectionWithScopes = Connection & {
  box_scopes: ConnectionBoxScope[];
};

export async function listConnectionsAction(): Promise<
  ActionResult<ConnectionWithScopes[]>
> {
  try {
    const { supabase, workspaceId } = await requireContext();
    const connections = await listConnectionsWithScopes(supabase, workspaceId);
    return { ok: true, data: connections };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load connections",
    };
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createConnectionAction(formData: FormData): Promise<
  ActionResult<{
    connection: Connection;
    rawToken: string;
  }>
> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    const name = (formData.get("name") as string | null)?.trim();
    const description = (formData.get("description") as string | null)?.trim() || null;
    const connection_type = formData.get("connection_type") as ConnectionType | null;
    const permission_mode = formData.get("permission_mode") as PermissionMode | null;
    const boxIds = formData.getAll("box_ids") as string[];

    if (!name) throw new Error("Name is required");
    if (!connection_type) throw new Error("Connection type is required");
    if (!permission_mode) throw new Error("Permission mode is required");

    const result = await createConnection(supabase, workspaceId, userId, {
      name,
      description,
      connection_type,
      permission_mode,
      boxIds: boxIds.filter(Boolean),
    });

    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create connection",
    };
  }
}

// ─── Rotate token ─────────────────────────────────────────────────────────────

export async function rotateTokenAction(
  connectionId: string
): Promise<ActionResult<{ rawToken: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const result = await rotateConnectionToken(
      supabase,
      connectionId,
      workspaceId,
      userId
    );
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to rotate token",
    };
  }
}

// ─── Revoke ───────────────────────────────────────────────────────────────────

export async function revokeConnectionAction(
  connectionId: string
): Promise<ActionResult<void>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    await revokeConnection(supabase, connectionId, workspaceId, userId);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to revoke connection",
    };
  }
}

// ─── Update metadata ──────────────────────────────────────────────────────────

export async function updateConnectionAction(
  connectionId: string,
  formData: FormData
): Promise<ActionResult<Connection>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    const name = (formData.get("name") as string | null)?.trim();
    const description =
      (formData.get("description") as string | null)?.trim() || null;
    const permission_mode = formData.get(
      "permission_mode"
    ) as PermissionMode | null;

    if (!name) throw new Error("Name is required");

    const updated = await updateConnectionMeta(
      supabase,
      connectionId,
      workspaceId,
      userId,
      { name, description, permission_mode: permission_mode ?? undefined }
    );
    return { ok: true, data: updated };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update connection",
    };
  }
}

// ─── Box scopes ───────────────────────────────────────────────────────────────

export async function addBoxScopeAction(
  connectionId: string,
  boxId: string
): Promise<ActionResult<ConnectionBoxScope>> {
  try {
    const { supabase, workspaceId } = await requireContext();
    const scope = await addConnectionBoxScope(
      supabase,
      connectionId,
      workspaceId,
      boxId
    );
    return { ok: true, data: scope };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to add box scope",
    };
  }
}

export async function removeBoxScopeAction(
  connectionId: string,
  boxId: string
): Promise<ActionResult<void>> {
  try {
    const { supabase, workspaceId } = await requireContext();
    await removeConnectionBoxScope(supabase, connectionId, workspaceId, boxId);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to remove box scope",
    };
  }
}
