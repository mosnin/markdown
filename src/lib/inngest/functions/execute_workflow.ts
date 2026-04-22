/**
 * Inngest function: execute a workflow run.
 *
 * Listens for `workflow.run` events. Loads the workflow graph from the
 * pre-created workflow_runs row, performs a topological sort, then executes
 * each node layer in parallel using step.run. Per-node outputs are accumulated
 * in a context map so downstream nodes can reference them via
 * `{{nodeKey.path}}` template syntax.
 *
 * Node types:
 *   start       — pass-through; outputs the run input
 *   subagent    — dispatches to Modal sub-agent endpoint via dispatchSubagentRun
 *   web_search  — calls Exa search API
 *   web_fetch   — fetches a URL and returns the text body
 *   transform   — one-shot OpenAI chat call (no agent loop)
 *   condition   — evaluates a simple DSL expression; routes true/false edge
 *   merge       — pass-through; merges all upstream outputs into one object
 *   end         — pass-through; sets final run output
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";
import {
  getWorkflowRunById,
  updateWorkflowRun,
  createWorkflowNodeRun,
  updateWorkflowNodeRun,
  listNodeRunsByRun,
} from "@/server/repositories/workflow_run_repository";
import { getWorkflowById } from "@/server/repositories/workflow_repository";
import { createSubagentInvocation } from "@/server/repositories/subagent_invocation_repository";
import {
  dispatchSubagentRun,
  resolveMaxTurns,
} from "@/server/services/subagent_dispatch_service";
import { resolveTemplate } from "@/server/services/workflow_template_service";
import type {
  WorkflowNode,
  WorkflowEdge,
  SubagentNodeConfig,
  WebSearchNodeConfig,
  WebFetchNodeConfig,
  TransformNodeConfig,
  ConditionNodeConfig,
} from "@/server/domain/types/workflow";

// ─── Topological sort ────────────────────────────────────────────────────────

/**
 * Returns nodes in BFS topological order (Kahn's algorithm).
 * Condition nodes produce two output slots (true/false handles), so
 * execution must not block waiting for both — nodes downstream of a false
 * branch are marked "skipped" when the condition resolves false.
 */
function topoSort(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): WorkflowNode[][] {
  const nodeMap = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>(nodes.map((n) => [n.id, []]));

  for (const edge of edges) {
    inDegree.set(edge.target_node_id, (inDegree.get(edge.target_node_id) ?? 0) + 1);
    outgoing.get(edge.source_node_id)?.push(edge.target_node_id);
  }

  const levels: WorkflowNode[][] = [];
  let queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);
  while (queue.length > 0) {
    levels.push(queue);
    const next: WorkflowNode[] = [];
    for (const node of queue) {
      for (const targetId of outgoing.get(node.id) ?? []) {
        const newDeg = (inDegree.get(targetId) ?? 0) - 1;
        inDegree.set(targetId, newDeg);
        if (newDeg === 0) {
          const n = nodeMap.get(targetId);
          if (n) next.push(n);
        }
      }
    }
    queue = next;
  }
  return levels;
}

// ─── Condition evaluator ─────────────────────────────────────────────────────

/**
 * Evaluates the restricted DSL: `{{nodeKey.path}} <op> "literal"|number`.
 * Returns true or false. Any evaluation failure returns false and logs.
 */
function evalCondition(
  expression: string,
  context: Record<string, Record<string, unknown>>
): boolean {
  try {
    const resolved = resolveTemplate(expression, context);
    // After template resolution the expression should be: `<value> <op> <literal>`
    const m = resolved.match(
      /^\s*(.+?)\s*(==|!=|>=|<=|>|<)\s*("[^"]*"|\d+(?:\.\d+)?)\s*$/
    );
    if (!m) return false;
    const [, lhsRaw, op, rhsRaw] = m;
    const lhs: unknown =
      lhsRaw.startsWith('"') ? lhsRaw.slice(1, -1) : Number(lhsRaw);
    const rhs: unknown =
      rhsRaw.startsWith('"') ? rhsRaw.slice(1, -1) : Number(rhsRaw);
    switch (op) {
      case "==": return lhs == rhs; // intentional loose for string↔number
      case "!=": return lhs != rhs;
      case ">":  return (lhs as number) > (rhs as number);
      case "<":  return (lhs as number) < (rhs as number);
      case ">=": return (lhs as number) >= (rhs as number);
      case "<=": return (lhs as number) <= (rhs as number);
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Node executors ──────────────────────────────────────────────────────────

async function execSubagent(
  node: WorkflowNode,
  context: Record<string, Record<string, unknown>>,
  meta: { workspaceId: string; userId: string | null; workflowRunId: string; nodeRunId: string }
): Promise<Record<string, unknown>> {
  const cfg = node.config as unknown as SubagentNodeConfig;
  const task = resolveTemplate(cfg.task_template, context);

  const admin = createAdminClient();
  const { data: skill } = await admin
    .from("skills")
    .select("id, workspace_id, subagent_tools, subagent_max_turns")
    .eq("id", cfg.skill_id)
    .maybeSingle();

  if (!skill || skill.workspace_id !== meta.workspaceId) {
    throw new Error(`Skill ${cfg.skill_id} not found or inaccessible`);
  }

  const subagent = await createSubagentInvocation(admin, {
    workspace_id: meta.workspaceId,
    parent_operator_run_id: null,
    skill_id: cfg.skill_id,
    user_id: meta.userId ?? "",
    task,
    depth: 1,
  });

  await updateWorkflowNodeRun(admin, meta.nodeRunId, {
    subagent_invocation_id: subagent.id,
  });

  const { modalRunId } = await dispatchSubagentRun({
    invocationId: subagent.id,
    workspaceId: meta.workspaceId,
    userId: meta.userId ?? "",
    skillId: cfg.skill_id,
    task,
    allowedTools: null,
    maxTurns: resolveMaxTurns(skill.subagent_max_turns as number | null),
    depth: 1,
    parentRunId: null,
  });

  await admin
    .from("subagent_invocations")
    .update({ status: "running", modal_run_id: modalRunId })
    .eq("id", subagent.id);

  // Poll until the subagent_invocations row reaches a terminal status.
  // Max 10 min, polling every 5s — Inngest step retries handle flakiness.
  const maxWaitMs = 600_000;
  const pollIntervalMs = 5_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const { data: row } = await admin
      .from("subagent_invocations")
      .select("status, output, error")
      .eq("id", subagent.id)
      .maybeSingle();

    if (!row) throw new Error("Subagent invocation row disappeared");
    const status = row.status as string;
    if (status === "completed") {
      return { output: row.output as string | null ?? "" };
    }
    if (status === "failed") {
      throw new Error(`Subagent failed: ${row.error ?? "unknown error"}`);
    }
    if (status === "cancelled") {
      throw new Error("Subagent was cancelled");
    }
  }
  throw new Error("Subagent timed out after 10 minutes");
}

async function execWebSearch(
  node: WorkflowNode,
  context: Record<string, Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const cfg = node.config as unknown as WebSearchNodeConfig;
  const query = resolveTemplate(cfg.query_template, context);
  const numResults = cfg.num_results ?? 5;

  const exaKey = process.env.EXA_API_KEY;
  if (!exaKey) throw new Error("EXA_API_KEY not configured");

  const resp = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": exaKey,
    },
    body: JSON.stringify({
      query,
      numResults,
      useAutoprompt: true,
      type: "neural",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Exa search failed ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    results?: Array<{ title: string; url: string; text?: string }>;
  };

  return { results: data.results ?? [] };
}

async function execWebFetch(
  node: WorkflowNode,
  context: Record<string, Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const cfg = node.config as unknown as WebFetchNodeConfig;
  const url = resolveTemplate(cfg.url_template, context);

  const resp = await fetch(url, {
    headers: { "User-Agent": "Poggle-Workflow/1.0" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new Error(`Fetch ${url} returned ${resp.status}`);
  }

  const text = await resp.text();
  return { body: text.slice(0, 50_000) };
}

async function execTransform(
  node: WorkflowNode,
  context: Record<string, Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const cfg = node.config as unknown as TransformNodeConfig;
  const userContent = resolveTemplate(cfg.user_prompt_template, context);
  const model = cfg.model ?? "gpt-4o-mini";

  const apiBase =
    process.env.EMBEDDING_API_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY ?? "";

  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: cfg.system_prompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Transform LLM call failed ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const output = data.choices?.[0]?.message?.content ?? "";
  return { output };
}

// ─── Main function ────────────────────────────────────────────────────────────

export const executeWorkflow = inngest.createFunction(
  {
    id: "execute-workflow",
    name: "Execute workflow run",
    retries: 1,
    timeouts: {
      finish: "15m",
    },
  },
  { event: "workflow.run" },
  async ({ event, step }) => {
    const { workflowId, workspaceId, userId, runId } = event.data;
    const admin = createAdminClient();

    // ── 1. Load the workflow + run row ──────────────────────────────────
    const [workflow, run] = await step.run("load-workflow", async () => {
      const wf = await getWorkflowById(admin, workflowId);
      const r = await getWorkflowRunById(admin, runId);
      return [wf, r] as const;
    });

    if (!workflow || !run) {
      throw new Error(`Workflow or run not found: ${workflowId} / ${runId}`);
    }

    // ── 2. Mark run as running ──────────────────────────────────────────
    await step.run("mark-running", () =>
      updateWorkflowRun(admin, runId, { status: "running" })
    );

    const { nodes, edges } = workflow.graph;
    if (!nodes || nodes.length === 0) {
      await updateWorkflowRun(admin, runId, {
        status: "completed",
        output: {},
        completed_at: new Date().toISOString(),
      });
      return { ok: true, runId };
    }

    // ── 3. Topological sort ─────────────────────────────────────────────
    const levels = topoSort(nodes, edges);

    // Build edge lookup: source_node_id → [edges]
    const outgoingEdges = new Map<string, WorkflowEdge[]>();
    for (const edge of edges) {
      const list = outgoingEdges.get(edge.source_node_id) ?? [];
      list.push(edge);
      outgoingEdges.set(edge.source_node_id, list);
    }

    // ── 4. Pre-create node run rows for all nodes ───────────────────────
    const nodeRunIdMap = await step.run("create-node-runs", async () => {
      const map: Record<string, string> = {};
      for (const node of nodes) {
        const nr = await createWorkflowNodeRun(admin, {
          workflow_run_id: runId,
          node_id: node.id,
        });
        map[node.id] = nr.id;
      }
      return map;
    });

    // ── 5. Execute level-by-level ───────────────────────────────────────
    // context accumulates outputs keyed by node_key so templates work.
    const context: Record<string, Record<string, unknown>> = {
      input: run.input,
    };

    // Track which nodes are skipped (false branch of condition).
    const skippedNodes = new Set<string>();

    try {
      for (const level of levels) {
        await step.run(`execute-level-${level.map((n) => n.node_key).join("-")}`, async () => {
          await Promise.all(
            level.map(async (node) => {
              const nodeRunId = nodeRunIdMap[node.id];

              if (skippedNodes.has(node.id)) {
                await updateWorkflowNodeRun(admin, nodeRunId, {
                  status: "skipped",
                  completed_at: new Date().toISOString(),
                });
                // Propagate skip to all downstream nodes.
                for (const edge of outgoingEdges.get(node.id) ?? []) {
                  skippedNodes.add(edge.target_node_id);
                }
                return;
              }

              await updateWorkflowNodeRun(admin, nodeRunId, {
                status: "running",
                started_at: new Date().toISOString(),
                input: context,
              });

              try {
                let output: Record<string, unknown>;

                switch (node.node_type) {
                  case "start": {
                    output = { ...run.input };
                    break;
                  }
                  case "subagent": {
                    output = await execSubagent(node, context, {
                      workspaceId,
                      userId,
                      workflowRunId: runId,
                      nodeRunId,
                    });
                    break;
                  }
                  case "web_search": {
                    output = await execWebSearch(node, context);
                    break;
                  }
                  case "web_fetch": {
                    output = await execWebFetch(node, context);
                    break;
                  }
                  case "transform": {
                    output = await execTransform(node, context);
                    break;
                  }
                  case "condition": {
                    const cfg = node.config as unknown as ConditionNodeConfig;
                    const result = evalCondition(cfg.expression, context);
                    output = { result };
                    // Skip nodes on the losing branch.
                    for (const edge of outgoingEdges.get(node.id) ?? []) {
                      if (edge.source_handle === "false" && result === true) {
                        skippedNodes.add(edge.target_node_id);
                      }
                      if (edge.source_handle === "true" && result === false) {
                        skippedNodes.add(edge.target_node_id);
                      }
                    }
                    break;
                  }
                  case "merge": {
                    // Collect all incoming node outputs into one object.
                    const merged: Record<string, unknown> = {};
                    const incomingEdges = edges.filter(
                      (e) => e.target_node_id === node.id
                    );
                    for (const edge of incomingEdges) {
                      const srcNode = nodes.find((n) => n.id === edge.source_node_id);
                      if (srcNode) {
                        merged[srcNode.node_key] = context[srcNode.node_key] ?? {};
                      }
                    }
                    output = merged;
                    break;
                  }
                  case "end": {
                    // Gather all upstream leaf outputs as the final output.
                    output = { ...context };
                    break;
                  }
                  default: {
                    output = {};
                  }
                }

                context[node.node_key] = output;

                await updateWorkflowNodeRun(admin, nodeRunId, {
                  status: "completed",
                  output,
                  completed_at: new Date().toISOString(),
                });
              } catch (nodeErr) {
                const msg =
                  nodeErr instanceof Error ? nodeErr.message : String(nodeErr);
                await updateWorkflowNodeRun(admin, nodeRunId, {
                  status: "failed",
                  error: msg,
                  completed_at: new Date().toISOString(),
                });
                throw nodeErr;
              }
            })
          );
        });
      }

      // ── 6. Collect final output from end node (or last node) ──────────
      const endNode = nodes.find((n) => n.node_type === "end");
      const finalOutput = endNode
        ? (context[endNode.node_key] ?? {})
        : context;

      await step.run("mark-completed", () =>
        updateWorkflowRun(admin, runId, {
          status: "completed",
          output: finalOutput as Record<string, unknown>,
          completed_at: new Date().toISOString(),
        })
      );

      return { ok: true, runId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateWorkflowRun(admin, runId, {
        status: "failed",
        error: msg,
        completed_at: new Date().toISOString(),
      });
      throw err;
    }
  }
);
