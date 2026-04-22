"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import {
  createWorkflow,
  getWorkflowById,
  listWorkflowsByWorkspace,
  updateWorkflow,
  replaceWorkflowGraph,
} from "@/server/repositories/workflow_repository";
import { createWorkflowRun } from "@/server/repositories/workflow_run_repository";
import { validateWorkflowGraph } from "@/server/services/workflow_validation_service";
import { inngest } from "@/lib/inngest/client";
import type { Workflow, WorkflowGraphInput } from "@/server/domain/types/workflow";

// ─── Create ──────────────────────────────────────────────────────────────────

export type CreateWorkflowResult =
  | { ok: true; workflowId: string }
  | { ok: false; error: string };

export async function createWorkflowAction(
  name: string
): Promise<CreateWorkflowResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const workflow = await createWorkflow(supabase, {
      workspace_id: ctx.workspace.id,
      user_id: ctx.user.id,
      name: name.trim(),
    });

    // Seed an empty graph with a single start node so the canvas has
    // something to render immediately.
    await replaceWorkflowGraph(supabase, workflow.id, {
      nodes: [
        {
          node_key: "start",
          node_type: "start",
          position: { x: 300, y: 100 },
          config: {},
        },
      ],
      edges: [],
    });

    revalidatePath("/app/workflows");
    return { ok: true, workflowId: workflow.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create workflow",
    };
  }
}

// ─── Save (patch metadata + graph together) ───────────────────────────────────

export type SaveWorkflowResult =
  | { ok: true }
  | { ok: false; error: string; validationErrors?: string[] };

export async function saveWorkflowAction(
  workflowId: string,
  patch: {
    name?: string;
    description?: string | null;
    graph?: WorkflowGraphInput;
  }
): Promise<SaveWorkflowResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const workflow = await getWorkflowById(supabase, workflowId);
    if (!workflow || workflow.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Workflow not found" };
    }

    if (patch.graph) {
      const validation = validateWorkflowGraph(patch.graph);
      if (!validation.ok) {
        return {
          ok: false,
          error: "Graph validation failed",
          validationErrors: validation.errors,
        };
      }
      await replaceWorkflowGraph(supabase, workflowId, patch.graph);
    }

    if (patch.name !== undefined || patch.description !== undefined) {
      await updateWorkflow(supabase, workflowId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
      });
    }

    revalidatePath(`/app/workflows/${workflowId}/edit`);
    revalidatePath("/app/workflows");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save workflow",
    };
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export type RunWorkflowResult =
  | { ok: true; runId: string }
  | { ok: false; error: string };

export async function runWorkflowAction(
  workflowId: string,
  input: Record<string, unknown> = {}
): Promise<RunWorkflowResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const workflow = await getWorkflowById(supabase, workflowId);
    if (!workflow || workflow.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Workflow not found" };
    }

    const run = await createWorkflowRun(supabase, {
      workflow_id: workflowId,
      workspace_id: ctx.workspace.id,
      user_id: ctx.user.id,
      input,
    });

    await inngest.send({
      name: "workflow.run",
      data: {
        workflowId,
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        input,
        runId: run.id,
      },
    });

    revalidatePath(`/app/workflows/${workflowId}/runs`);
    return { ok: true, runId: run.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to start workflow",
    };
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────

export type ListWorkflowsResult =
  | { ok: true; workflows: Workflow[] }
  | { ok: false; error: string };

export async function listWorkflowsAction(): Promise<ListWorkflowsResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const workflows = await listWorkflowsByWorkspace(supabase, ctx.workspace.id, {
      limit: 100,
    });
    return { ok: true, workflows };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list workflows",
    };
  }
}

// ─── Get single workflow ──────────────────────────────────────────────────────

export type GetWorkflowResult =
  | { ok: true; workflow: Workflow }
  | { ok: false; error: string };

export async function getWorkflowAction(
  workflowId: string
): Promise<GetWorkflowResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const workflow = await getWorkflowById(supabase, workflowId);
    if (!workflow || workflow.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Workflow not found" };
    }
    return { ok: true, workflow };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load workflow",
    };
  }
}
