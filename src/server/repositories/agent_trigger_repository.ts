/**
 * Repository helpers for the `agent_triggers` table, scoped to the
 * workflow-schedule variant.
 *
 * Triggers in this table can target exactly one of:
 *   - an agent (agent_id set, workflow_id null)
 *   - a workflow (agent_id null, workflow_id set)
 *
 * This file holds the workflow-side CRUD only. The agent-side paths remain
 * handled by their existing server actions / Python harness.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AgentTriggerRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  workflow_id: string | null;
  trigger_type: "note_created" | "note_updated" | "schedule" | "manual";
  box_id: string | null;
  cron_expression: string | null;
  label: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkflowScheduleTriggerInput {
  workspaceId: string;
  workflowId: string;
  cronExpression: string;
  label?: string;
  isEnabled?: boolean;
}

export async function createWorkflowScheduleTrigger(
  supabase: SupabaseClient,
  input: CreateWorkflowScheduleTriggerInput
): Promise<AgentTriggerRow> {
  const { data, error } = await supabase
    .from("agent_triggers")
    .insert({
      workspace_id: input.workspaceId,
      agent_id: null,
      workflow_id: input.workflowId,
      trigger_type: "schedule",
      cron_expression: input.cronExpression,
      label: input.label ?? "",
      is_enabled: input.isEnabled ?? true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as AgentTriggerRow;
}

export interface UpdateWorkflowScheduleTriggerPatch {
  cronExpression?: string;
  isEnabled?: boolean;
  label?: string;
}

export async function updateWorkflowScheduleTrigger(
  supabase: SupabaseClient,
  triggerId: string,
  patch: UpdateWorkflowScheduleTriggerPatch
): Promise<void> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.cronExpression !== undefined) dbPatch.cron_expression = patch.cronExpression;
  if (patch.isEnabled !== undefined) dbPatch.is_enabled = patch.isEnabled;
  if (patch.label !== undefined) dbPatch.label = patch.label;

  if (Object.keys(dbPatch).length === 0) return;

  const { error } = await supabase
    .from("agent_triggers")
    .update(dbPatch)
    .eq("id", triggerId);
  if (error) throw error;
}

export async function getWorkflowScheduleTrigger(
  supabase: SupabaseClient,
  triggerId: string
): Promise<AgentTriggerRow | null> {
  const { data, error } = await supabase
    .from("agent_triggers")
    .select("*")
    .eq("id", triggerId)
    .maybeSingle();
  if (error) throw error;
  return (data as AgentTriggerRow) ?? null;
}

export async function deleteWorkflowScheduleTrigger(
  supabase: SupabaseClient,
  triggerId: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_triggers")
    .delete()
    .eq("id", triggerId);
  if (error) throw error;
}
