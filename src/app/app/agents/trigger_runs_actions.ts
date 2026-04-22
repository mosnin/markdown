"use server";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import {
  listRunsByTrigger,
  getRunSummaryForTrigger,
} from "@/server/repositories/agent_trigger_run_repository";
import type { AgentTriggerRun } from "@/server/domain/types/agent_trigger_run";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface TriggerRunSummary {
  total: number;
  succeeded: number;
  failed: number;
  lastRun: AgentTriggerRun | null;
}

/**
 * Workspace-ownership check: we trust listRunsByTrigger's filter because
 * RLS is enforced via the workspace-member-aware client. As a defensive
 * extra, we verify the trigger belongs to the caller's workspace first.
 */
async function verifyTriggerOwnership(triggerId: string) {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const { data: trigger, error } = await supabase
    .from("agent_triggers")
    .select("id, workspace_id")
    .eq("id", triggerId)
    .maybeSingle();
  if (error || !trigger || trigger.workspace_id !== ctx.workspace.id) {
    throw new Error("Trigger not found");
  }
  return { ctx, supabase };
}

export async function listTriggerRunsAction(
  triggerId: string,
  limit: number = 50
): Promise<ActionResult<AgentTriggerRun[]>> {
  try {
    const { supabase } = await verifyTriggerOwnership(triggerId);
    const runs = await listRunsByTrigger(supabase, triggerId, { limit });
    return { ok: true, data: runs };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function getTriggerRunSummaryAction(
  triggerId: string
): Promise<ActionResult<TriggerRunSummary>> {
  try {
    const { supabase } = await verifyTriggerOwnership(triggerId);
    const summary = await getRunSummaryForTrigger(supabase, triggerId, {
      limit: 50,
    });
    return { ok: true, data: summary };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
