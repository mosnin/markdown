"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import {
  getSubagentInvocationById,
  listInvocationsByParent,
  listRecentInvocationsByWorkspace,
} from "@/server/repositories/subagent_invocation_repository";
import type { SubagentInvocation } from "@/server/domain/types/subagent";

export type ListInvocationsResult =
  | { ok: true; data: SubagentInvocation[] }
  | { ok: false; error: string };

export async function listRecentSubagentInvocationsAction(
  limit = 50
): Promise<ListInvocationsResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const data = await listRecentInvocationsByWorkspace(
      supabase,
      ctx.workspace.id,
      { limit }
    );
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load invocations",
    };
  }
}

export type GetInvocationResult =
  | { ok: true; data: SubagentInvocation }
  | { ok: false; error: string };

export async function getSubagentInvocationAction(
  invocationId: string
): Promise<GetInvocationResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const row = await getSubagentInvocationById(supabase, invocationId);
    if (!row) return { ok: false, error: "Invocation not found" };
    if (row.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not authorised" };
    }
    return { ok: true, data: row };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load invocation",
    };
  }
}

export async function listInvocationsByOperatorRunAction(
  operatorRunId: string
): Promise<ListInvocationsResult> {
  try {
    await requireAuthenticatedUser();
    const supabase = await createClient();
    const data = await listInvocationsByParent(supabase, operatorRunId);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load invocations",
    };
  }
}
