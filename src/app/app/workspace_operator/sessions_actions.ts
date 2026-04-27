"use server";

import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  createOperatorSession,
  listOperatorSessions,
  updateOperatorSession,
  deleteOperatorSession,
  type OperatorSession,
} from "@/server/services/operator_sessions_service";
import {
  listOperatorRuns,
  type WorkspaceOperatorRunRow,
} from "@/server/services/workspace_operator_runs_service";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── List sessions ────────────────────────────────────────────────────────────

export async function listSessionsAction(): Promise<ActionResult<OperatorSession[]>> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const sessions = await listOperatorSessions(
      supabase,
      ctx.workspace.id,
      ctx.user.id
    );
    return { ok: true, data: sessions };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Create session ───────────────────────────────────────────────────────────

export async function createSessionAction(
  name?: string
): Promise<ActionResult<OperatorSession>> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const session = await createOperatorSession(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      name: name ?? "New session",
    });
    return { ok: true, data: session };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Rename session ───────────────────────────────────────────────────────────

export async function renameSessionAction(
  sessionId: string,
  name: string
): Promise<ActionResult<OperatorSession>> {
  if (!sessionId) return { ok: false, error: "Session ID is required" };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name cannot be empty" };
  try {
    const supabase = await createClient();
    const session = await updateOperatorSession(supabase, sessionId, { name: trimmed });
    return { ok: true, data: session };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Delete session ───────────────────────────────────────────────────────────

export async function deleteSessionAction(
  sessionId: string
): Promise<ActionResult<void>> {
  if (!sessionId) return { ok: false, error: "Session ID is required" };
  try {
    const supabase = await createClient();
    await deleteOperatorSession(supabase, sessionId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── List runs for a session ──────────────────────────────────────────────────

export async function listSessionRunsAction(
  sessionId: string,
  limit = 20
): Promise<ActionResult<WorkspaceOperatorRunRow[]>> {
  if (!sessionId) return { ok: false, error: "Session ID is required" };
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const result = await listOperatorRuns(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      sessionId,
      limit,
    });
    return { ok: true, data: result.rows };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
