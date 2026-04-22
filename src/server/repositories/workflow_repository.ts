import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Workflow,
  WorkflowEdge,
  WorkflowGraphInput,
  WorkflowNode,
  WorkflowStatus,
} from "@/server/domain/types/workflow";

export interface CreateWorkflowInput {
  workspace_id: string;
  user_id?: string | null;
  name: string;
  description?: string | null;
  status?: WorkflowStatus;
  trigger_id?: string | null;
}

export interface UpdateWorkflowPatch {
  name?: string;
  description?: string | null;
  status?: WorkflowStatus;
  trigger_id?: string | null;
}

export interface ListWorkflowsOptions {
  limit?: number;
  status?: WorkflowStatus;
}

export async function createWorkflow(
  supabase: SupabaseClient,
  input: CreateWorkflowInput
): Promise<Workflow> {
  const { data, error } = await supabase
    .from("workflows")
    .insert({
      workspace_id: input.workspace_id,
      user_id: input.user_id ?? null,
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? "draft",
      trigger_id: input.trigger_id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Workflow;
}

export async function getWorkflowById(
  supabase: SupabaseClient,
  id: string
): Promise<Workflow | null> {
  const { data, error } = await supabase
    .from("workflows")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Workflow) ?? null;
}

export async function listWorkflowsByWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: ListWorkflowsOptions = {}
): Promise<Workflow[]> {
  let q = supabase
    .from("workflows")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Workflow[];
}

export async function updateWorkflow(
  supabase: SupabaseClient,
  id: string,
  patch: UpdateWorkflowPatch
): Promise<void> {
  const { error } = await supabase
    .from("workflows")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteWorkflow(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase.from("workflows").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Replace a workflow's graph (nodes + edges) with a fresh snapshot.
 *
 * Edges are deleted first (so they don't block node deletion via FK), then
 * nodes. New nodes are inserted with fresh uuids when not provided, then
 * edges are rewritten using a node_key → new db id map. Finally the
 * `workflows.graph` denormalised snapshot is refreshed for fast reads.
 *
 * No SQL transaction is used — the UI re-saves on failure.
 */
export async function replaceWorkflowGraph(
  supabase: SupabaseClient,
  workflowId: string,
  graph: WorkflowGraphInput
): Promise<void> {
  try {
    // 1. Delete existing edges first (before nodes, so FK doesn't cascade
    //    unexpectedly and so we keep ordering explicit).
    const { error: edgeDelErr } = await supabase
      .from("workflow_edges")
      .delete()
      .eq("workflow_id", workflowId);
    if (edgeDelErr) throw edgeDelErr;

    // 2. Delete existing nodes.
    const { error: nodeDelErr } = await supabase
      .from("workflow_nodes")
      .delete()
      .eq("workflow_id", workflowId);
    if (nodeDelErr) throw nodeDelErr;

    // 3. Insert fresh nodes. Assign ids up-front so we can build the
    //    node_key → id map for edge insertion.
    const nodeRows = graph.nodes.map((n) => ({
      id: n.id ?? randomUUID(),
      workflow_id: workflowId,
      node_key: n.node_key,
      node_type: n.node_type,
      position: n.position,
      config: n.config,
    }));

    let insertedNodes: WorkflowNode[] = [];
    if (nodeRows.length > 0) {
      const { data, error } = await supabase
        .from("workflow_nodes")
        .insert(nodeRows)
        .select("*");
      if (error) throw error;
      insertedNodes = (data ?? []) as WorkflowNode[];
    }

    // 4. Build node_key → id map, insert edges using resolved ids.
    const keyToId = new Map<string, string>();
    for (const row of insertedNodes) {
      keyToId.set(row.node_key, row.id);
    }

    const edgeRows = graph.edges.map((e) => {
      const sourceId = keyToId.get(e.source_node_key);
      const targetId = keyToId.get(e.target_node_key);
      if (!sourceId) {
        throw new Error(
          `Edge references unknown source node_key "${e.source_node_key}"`
        );
      }
      if (!targetId) {
        throw new Error(
          `Edge references unknown target node_key "${e.target_node_key}"`
        );
      }
      return {
        id: e.id ?? randomUUID(),
        workflow_id: workflowId,
        source_node_id: sourceId,
        target_node_id: targetId,
        source_handle: e.source_handle ?? null,
        label: e.label ?? null,
      };
    });

    let insertedEdges: WorkflowEdge[] = [];
    if (edgeRows.length > 0) {
      const { data, error } = await supabase
        .from("workflow_edges")
        .insert(edgeRows)
        .select("*");
      if (error) throw error;
      insertedEdges = (data ?? []) as WorkflowEdge[];
    }

    // 5. Refresh denormalised graph snapshot + updated_at.
    const snapshot = {
      nodes: insertedNodes,
      edges: insertedEdges,
    };
    const { error: updErr } = await supabase
      .from("workflows")
      .update({
        graph: snapshot,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workflowId);
    if (updErr) throw updErr;
  } catch (err) {
    throw err instanceof Error
      ? err
      : new Error(`replaceWorkflowGraph failed: ${String(err)}`);
  }
}
