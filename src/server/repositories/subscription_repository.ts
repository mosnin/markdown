import { type SupabaseClient } from "@supabase/supabase-js";
import {
  type WorkspaceSubscription,
  type UpsertSubscriptionInput,
} from "@/server/domain/types/subscription";
import { RepositoryError } from "@/server/domain/errors";

/**
 * Subscription repository.
 *
 * Data access only — no business logic. Callers (services / webhook handlers)
 * are responsible for authorization checks before calling these functions.
 *
 * All functions accept a Supabase client so they work with both the server
 * client (human session) and the service-role client (webhook handlers).
 */

/**
 * Returns the subscription for a given workspace, or null if none exists.
 */
export async function getSubscriptionByWorkspaceId(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceSubscription | null> {
  const { data, error } = await supabase
    .from("workspace_subscriptions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .single();

  if (error || !data) return null;
  return data as WorkspaceSubscription;
}

/**
 * Returns the subscription for a given Creem subscription ID, or null if none
 * exists. Useful in webhook handlers where the workspace_id is not known.
 */
export async function getSubscriptionByCreemId(
  supabase: SupabaseClient,
  creemSubscriptionId: string
): Promise<WorkspaceSubscription | null> {
  const { data, error } = await supabase
    .from("workspace_subscriptions")
    .select("*")
    .eq("creem_subscription_id", creemSubscriptionId)
    .single();

  if (error || !data) return null;
  return data as WorkspaceSubscription;
}

/**
 * Creates or updates the subscription record for a workspace.
 *
 * Uses an upsert on workspace_id (the unique constraint) so webhook handlers
 * can call this idempotently without needing to check existence first.
 */
export async function upsertSubscription(
  supabase: SupabaseClient,
  input: UpsertSubscriptionInput
): Promise<WorkspaceSubscription> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("workspace_subscriptions")
    .upsert(
      {
        ...input,
        updated_at: now,
      },
      { onConflict: "workspace_id" }
    )
    .select()
    .single();

  if (error || !data) {
    throw new RepositoryError("upsertSubscription", error);
  }

  return data as WorkspaceSubscription;
}
