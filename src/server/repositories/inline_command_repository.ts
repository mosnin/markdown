import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InlineCommandInvocation,
  InlineCommandStatus,
} from "@/server/domain/types/inline_command";

export async function createInlineCommandInvocation(
  supabase: SupabaseClient,
  input: {
    workspace_id: string;
    user_id: string;
    note_id: string;
    command_id: string;
    subagent_invocation_id?: string | null;
    selection_start?: number | null;
    selection_end?: number | null;
  }
): Promise<InlineCommandInvocation> {
  const { data, error } = await supabase
    .from("inline_command_invocations")
    .insert({
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      note_id: input.note_id,
      command_id: input.command_id,
      subagent_invocation_id: input.subagent_invocation_id ?? null,
      selection_start: input.selection_start ?? null,
      selection_end: input.selection_end ?? null,
      status: "running",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as InlineCommandInvocation;
}

export async function updateInlineCommandInvocation(
  supabase: SupabaseClient,
  id: string,
  patch: {
    status?: InlineCommandStatus;
    output?: string | null;
    error?: string | null;
    completed_at?: string | null;
    subagent_invocation_id?: string | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from("inline_command_invocations")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function getInlineCommandInvocationById(
  supabase: SupabaseClient,
  id: string
): Promise<InlineCommandInvocation | null> {
  const { data, error } = await supabase
    .from("inline_command_invocations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as InlineCommandInvocation) ?? null;
}
