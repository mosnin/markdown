import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BrowsingSession,
  BrowsingSessionStatus,
  BrowsingSessionStep,
  BrowsingStepAction,
} from "@/server/domain/types/web_tool";

export async function createBrowsingSession(
  supabase: SupabaseClient,
  input: {
    workspace_id: string;
    user_id: string;
    operator_run_id?: string | null;
    browserbase_session_id: string;
    goal?: string | null;
    live_url?: string | null;
  }
): Promise<BrowsingSession> {
  const { data, error } = await supabase
    .from("browsing_sessions")
    .insert({
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      operator_run_id: input.operator_run_id ?? null,
      browserbase_session_id: input.browserbase_session_id,
      goal: input.goal ?? null,
      live_url: input.live_url ?? null,
      status: "active",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as BrowsingSession;
}

export async function getBrowsingSessionById(
  supabase: SupabaseClient,
  id: string
): Promise<BrowsingSession | null> {
  const { data, error } = await supabase
    .from("browsing_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as BrowsingSession) ?? null;
}

export async function updateBrowsingSessionStatus(
  supabase: SupabaseClient,
  id: string,
  patch: {
    status: BrowsingSessionStatus;
    error?: string | null;
    page_count?: number;
    total_cost_cents?: number;
    completed_at?: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from("browsing_sessions")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function listSessionsByWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { limit?: number; status?: BrowsingSessionStatus } = {}
): Promise<BrowsingSession[]> {
  let q = supabase
    .from("browsing_sessions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false });
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as BrowsingSession[];
}

export async function recordBrowsingStep(
  supabase: SupabaseClient,
  input: {
    session_id: string;
    step_number: number;
    action: BrowsingStepAction;
    url?: string | null;
    selector?: string | null;
    value?: string | null;
    extracted_content?: string | null;
    screenshot_url?: string | null;
    action_took_ms?: number | null;
  }
): Promise<BrowsingSessionStep> {
  const { data, error } = await supabase
    .from("browsing_session_steps")
    .insert({
      session_id: input.session_id,
      step_number: input.step_number,
      action: input.action,
      url: input.url ?? null,
      selector: input.selector ?? null,
      value: input.value ?? null,
      extracted_content: input.extracted_content ?? null,
      screenshot_url: input.screenshot_url ?? null,
      action_took_ms: input.action_took_ms ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as BrowsingSessionStep;
}

export async function listStepsBySession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<BrowsingSessionStep[]> {
  const { data, error } = await supabase
    .from("browsing_session_steps")
    .select("*")
    .eq("session_id", sessionId)
    .order("step_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BrowsingSessionStep[];
}
