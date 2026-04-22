"use server";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface AgentTrigger {
  id: string;
  agent_id: string;
  trigger_type: "note_created" | "note_updated" | "schedule" | "manual";
  box_id: string | null;
  cron_expression: string | null;
  label: string;
  is_enabled: boolean;
  created_at: string;
}

export type TriggerActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function listAgentTriggersAction(
  agentId: string
): Promise<TriggerActionResult<AgentTrigger[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("agent_triggers")
      .select("*")
      .eq("agent_id", agentId)
      .eq("workspace_id", ctx.workspace.id)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return { ok: true, data: data as AgentTrigger[] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function createAgentTriggerAction(
  agentId: string,
  input: {
    trigger_type: AgentTrigger["trigger_type"];
    box_id?: string | null;
    cron_expression?: string | null;
    label: string;
  }
): Promise<TriggerActionResult<{ id: string }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("agent_triggers")
      .insert({
        agent_id: agentId,
        workspace_id: ctx.workspace.id,
        trigger_type: input.trigger_type,
        box_id: input.box_id ?? null,
        cron_expression: input.cron_expression ?? null,
        label: input.label,
        is_enabled: true,
      })
      .select("id")
      .single();

    if (error) throw error;
    revalidatePath(`/app/agents/${agentId}`);
    return { ok: true, data: { id: data.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function deleteAgentTriggerAction(
  triggerId: string
): Promise<TriggerActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const { error } = await supabase
      .from("agent_triggers")
      .delete()
      .eq("id", triggerId)
      .eq("workspace_id", ctx.workspace.id);

    if (error) throw error;
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function toggleAgentTriggerAction(
  triggerId: string,
  isEnabled: boolean
): Promise<TriggerActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const { error } = await supabase
      .from("agent_triggers")
      .update({ is_enabled: isEnabled })
      .eq("id", triggerId)
      .eq("workspace_id", ctx.workspace.id);

    if (error) throw error;
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
