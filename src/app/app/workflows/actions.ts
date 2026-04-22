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
import {
  createWorkflowScheduleTrigger,
  deleteWorkflowScheduleTrigger,
  getWorkflowScheduleTrigger,
  updateWorkflowScheduleTrigger,
} from "@/server/repositories/agent_trigger_repository";
import { validateWorkflowGraph } from "@/server/services/workflow_validation_service";
import { describeCron } from "@/lib/cron";
import { inngest } from "@/lib/inngest/client";
import { findWorkflowTemplateById } from "@/server/domain/workflow_templates";
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

// ─── Create from template ─────────────────────────────────────────────────────

export type CreateWorkflowFromTemplateResult =
  | { ok: true; workflowId: string }
  | { ok: false; error: string };

export async function createWorkflowFromTemplateAction(
  templateId: string,
  customName?: string
): Promise<CreateWorkflowFromTemplateResult> {
  try {
    const template = findWorkflowTemplateById(templateId);
    if (!template) {
      return { ok: false, error: "Template not found" };
    }

    // Run validation up front so we fail cheaply before writing anything.
    const validation = validateWorkflowGraph(template.graph);
    if (!validation.ok) {
      return {
        ok: false,
        error: `Template graph is invalid: ${validation.errors.join("; ")}`,
      };
    }

    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const workflow = await createWorkflow(supabase, {
      workspace_id: ctx.workspace.id,
      user_id: ctx.user.id,
      name: (customName?.trim() ? customName.trim() : template.name),
    });

    await replaceWorkflowGraph(supabase, workflow.id, template.graph);

    revalidatePath("/app/workflows");
    return { ok: true, workflowId: workflow.id };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to create workflow from template",
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

// ─── Schedule (cron) trigger ─────────────────────────────────────────────────

export type SetWorkflowScheduleResult =
  | { ok: true; triggerId: string }
  | { ok: false; error: string };

export async function setWorkflowScheduleAction(
  workflowId: string,
  cronExpression: string,
  enabled: boolean = true
): Promise<SetWorkflowScheduleResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const validation = describeCron(cronExpression);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }

    const workflow = await getWorkflowById(supabase, workflowId);
    if (!workflow || workflow.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Workflow not found" };
    }

    // If the workflow already has a trigger, update it in place. Otherwise
    // insert a new trigger row and point the workflow at it.
    if (workflow.trigger_id) {
      await updateWorkflowScheduleTrigger(supabase, workflow.trigger_id, {
        cronExpression: cronExpression.trim(),
        isEnabled: enabled,
      });
      revalidatePath(`/app/workflows/${workflowId}/edit`);
      return { ok: true, triggerId: workflow.trigger_id };
    }

    // Insert the trigger disabled so it can't fire until the workflow
    // successfully points at it. If the pair-linking update fails we
    // delete the trigger to avoid orphan rows that would still match the
    // cron selector once re-enabled by another path.
    const trigger = await createWorkflowScheduleTrigger(supabase, {
      workspaceId: ctx.workspace.id,
      workflowId,
      cronExpression: cronExpression.trim(),
      isEnabled: false,
    });

    try {
      await updateWorkflow(supabase, workflowId, { trigger_id: trigger.id });
    } catch (linkErr) {
      await deleteWorkflowScheduleTrigger(supabase, trigger.id).catch(() => {});
      throw linkErr;
    }

    if (enabled) {
      await updateWorkflowScheduleTrigger(supabase, trigger.id, {
        isEnabled: true,
      });
    }

    revalidatePath(`/app/workflows/${workflowId}/edit`);
    return { ok: true, triggerId: trigger.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to set schedule",
    };
  }
}

export type ClearWorkflowScheduleResult =
  | { ok: true }
  | { ok: false; error: string };

export async function clearWorkflowScheduleAction(
  workflowId: string
): Promise<ClearWorkflowScheduleResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const workflow = await getWorkflowById(supabase, workflowId);
    if (!workflow || workflow.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Workflow not found" };
    }

    if (workflow.trigger_id) {
      // Null the workflow's FK first so the trigger row can be deleted
      // without leaving a dangling reference.
      await updateWorkflow(supabase, workflowId, { trigger_id: null });
      await deleteWorkflowScheduleTrigger(supabase, workflow.trigger_id);
    }

    revalidatePath(`/app/workflows/${workflowId}/edit`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to clear schedule",
    };
  }
}

export type WorkflowScheduleInfo = {
  id: string;
  cron_expression: string | null;
  is_enabled: boolean;
  label: string;
};

export type GetWorkflowScheduleResult =
  | { ok: true; trigger: WorkflowScheduleInfo | null }
  | { ok: false; error: string };

export async function getWorkflowScheduleAction(
  workflowId: string
): Promise<GetWorkflowScheduleResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const workflow = await getWorkflowById(supabase, workflowId);
    if (!workflow || workflow.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Workflow not found" };
    }

    if (!workflow.trigger_id) {
      return { ok: true, trigger: null };
    }

    const row = await getWorkflowScheduleTrigger(supabase, workflow.trigger_id);
    if (!row) {
      return { ok: true, trigger: null };
    }

    return {
      ok: true,
      trigger: {
        id: row.id,
        cron_expression: row.cron_expression,
        is_enabled: row.is_enabled,
        label: row.label,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load schedule",
    };
  }
}
