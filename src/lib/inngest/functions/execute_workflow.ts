/**
 * Inngest function: execute a workflow run.
 *
 * Architecture:
 * - Loads workflow graph, topologically sorts it into levels
 * - Each level is executed level-by-level (levels are parallel within themselves)
 * - Sync nodes (start/web_search/web_fetch/transform/condition/merge/end) run
 *   inside a single step.run per level
 * - Subagent nodes are dispatched in one step.run then polled using step.sleep +
 *   step.run — never using setTimeout inside a step, which violates Inngest's
 *   deterministic execution model
 * - Context (nodeKey → output) is reconstructed from accumulated step results
 *   on each Inngest replay — no mutable local state crosses step boundaries
 */

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";
import {
  getWorkflowRunById,
  updateWorkflowRun,
  createWorkflowNodeRun,
  updateWorkflowNodeRun,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeRunOutput = {
  nodeId: string;
  nodeKey: string;
  output: Record<string, unknown>;
  skipped: boolean;
  /** IDs of nodes that should be skipped due to a condition branch. */
  skippedDownstreamIds: string[];
};

// ─── Topological sort (Kahn's algorithm) ─────────────────────────────────────

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

function levelId(level: WorkflowNode[]): string {
  return createHash("sha256")
    .update(level.map((n) => n.id).join(","))
    .digest("hex")
    .slice(0, 8);
}

// ─── URL safety (P0-1: SSRF protection) ──────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "metadata.google.internal",
]);

function assertSafeUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Only HTTP(S) URLs are allowed (got ${parsed.protocol})`);
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`Internal host blocked: ${host}`);
  }
  // Block RFC-1918 and link-local ranges
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 169) {
      throw new Error(`Private IP range blocked: ${host}`);
    }
  }
}

// ─── Condition evaluator ──────────────────────────────────────────────────────

function evalCondition(
  expression: string,
  context: Record<string, Record<string, unknown>>
): boolean {
  try {
    const resolved = resolveTemplate(expression, context);
    const m = resolved.match(
      /^\s*(.+?)\s*(==|!=|>=|<=|>|<)\s*("[^"]*"|\d+(?:\.\d+)?)\s*$/
    );
    if (!m) return false;
    const [, lhsRaw, op, rhsRaw] = m;
    // Strict parsing: only compare same types to avoid coercion bugs.
    const rhsIsString = rhsRaw.startsWith('"');
    const rhs: string | number = rhsIsString
      ? rhsRaw.slice(1, -1)
      : Number(rhsRaw);
    const lhs: string | number = rhsIsString
      ? String(lhsRaw.trim())
      : Number(lhsRaw.trim());
    switch (op) {
      case "==": return lhs === rhs;
      case "!=": return lhs !== rhs;
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

// ─── Sync node executor (all non-subagent types) ──────────────────────────────

async function execSyncNode(
  node: WorkflowNode,
  context: Record<string, Record<string, unknown>>,
  edges: WorkflowEdge[],
  outgoingEdges: Map<string, WorkflowEdge[]>
): Promise<Omit<NodeRunOutput, "nodeId">> {
  const base = { nodeKey: node.node_key, skipped: false, skippedDownstreamIds: [] as string[] };

  switch (node.node_type) {
    case "start": {
      return { ...base, output: { ...context["input"] } };
    }

    case "web_search": {
      const cfg = node.config as unknown as WebSearchNodeConfig;
      const query = resolveTemplate(cfg.query_template, context);
      const numResults = cfg.num_results ?? 5;
      const exaKey = process.env.EXA_API_KEY;
      if (!exaKey) throw new Error("EXA_API_KEY not configured");

      const resp = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": exaKey },
        body: JSON.stringify({ query, numResults, useAutoprompt: true, type: "neural" }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Exa search failed ${resp.status}: ${text.slice(0, 300)}`);
      }
      const data = (await resp.json()) as { results?: Array<{ title: string; url: string; text?: string }> };
      return { ...base, output: { results: data.results ?? [] } };
    }

    case "web_fetch": {
      const cfg = node.config as unknown as WebFetchNodeConfig;
      const url = resolveTemplate(cfg.url_template, context);
      assertSafeUrl(url); // P0-1: SSRF protection
      const resp = await fetch(url, {
        headers: { "User-Agent": "Poggle-Workflow/1.0" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) throw new Error(`Fetch ${url} returned ${resp.status}`);
      const body = await resp.text();
      return { ...base, output: { body: body.slice(0, 50_000) } };
    }

    case "transform": {
      const cfg = node.config as unknown as TransformNodeConfig;
      const userContent = resolveTemplate(cfg.user_prompt_template, context);
      const model = cfg.model ?? "gpt-4o-mini";
      const apiBase = process.env.EMBEDDING_API_BASE_URL ?? "https://api.openai.com/v1";
      const apiKey = process.env.OPENAI_API_KEY ?? "";

      const resp = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
      const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return { ...base, output: { output: data.choices?.[0]?.message?.content ?? "" } };
    }

    case "condition": {
      const cfg = node.config as unknown as ConditionNodeConfig;
      const result = evalCondition(cfg.expression, context);
      const skippedDownstreamIds: string[] = [];
      for (const edge of outgoingEdges.get(node.id) ?? []) {
        if (edge.source_handle === "false" && result === true) skippedDownstreamIds.push(edge.target_node_id);
        if (edge.source_handle === "true" && result === false) skippedDownstreamIds.push(edge.target_node_id);
      }
      return { ...base, output: { result }, skippedDownstreamIds };
    }

    case "merge": {
      const merged: Record<string, unknown> = {};
      for (const edge of edges.filter((e) => e.target_node_id === node.id)) {
        const srcKey = context[edge.source_node_id] ? edge.source_node_id : undefined;
        if (srcKey) merged[srcKey] = context[srcKey];
      }
      return { ...base, output: merged };
    }

    case "end": {
      return { ...base, output: { ...context } };
    }

    default: {
      return { ...base, output: {} };
    }
  }
}

// ─── Main function ────────────────────────────────────────────────────────────

export const executeWorkflow = inngest.createFunction(
  {
    id: "execute-workflow",
    name: "Execute workflow run",
    retries: 1,
    timeouts: { finish: "15m" },
  },
  { event: "workflow.run" },
  async ({ event, step }) => {
    const { workflowId, workspaceId, userId, runId } = event.data;
    const admin = createAdminClient();

    // ── 1. Load + verify workspace ownership (P0-2) ─────────────────────
    const [workflow, run] = await step.run("load-workflow", async () => {
      const wf = await getWorkflowById(admin, workflowId);
      const r = await getWorkflowRunById(admin, runId);
      return [wf, r] as const;
    });

    if (!workflow || !run) {
      throw new Error(`Workflow or run not found: ${workflowId} / ${runId}`);
    }
    // P0-2: verify workspace matches what the event claims
    if (workflow.workspace_id !== workspaceId) {
      throw new Error("Workflow workspace mismatch — refusing to execute");
    }

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

    // ── 2. Topological sort + build lookups ─────────────────────────────
    const levels = topoSort(nodes, edges);
    const outgoingEdges = new Map<string, WorkflowEdge[]>();
    for (const edge of edges) {
      const list = outgoingEdges.get(edge.source_node_id) ?? [];
      list.push(edge);
      outgoingEdges.set(edge.source_node_id, list);
    }

    // ── 3. Pre-create node run rows ──────────────────────────────────────
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

    // ── 4. Level-by-level execution ──────────────────────────────────────
    // `allOutputs` accumulates NodeRunOutput across all levels. On Inngest
    // replay, completed step.run calls return their cached values, so
    // allOutputs is correctly rebuilt each time without mutable global state.
    const allOutputs: NodeRunOutput[] = [];
    const skippedNodeIds = new Set<string>();

    try {
      for (const level of levels) {
        const lid = levelId(level); // P0-3: hash-based, not user-controlled

        // Build context from all prior node outputs.
        const context: Record<string, Record<string, unknown>> = { input: run.input };
        for (const out of allOutputs) {
          context[out.nodeKey] = out.output;
        }

        const syncNodes = level.filter((n) => n.node_type !== "subagent");
        const subagentNodes = level.filter((n) => n.node_type === "subagent");

        // ── Sync nodes (deterministic, run inside one step) ──────────────
        if (syncNodes.length > 0) {
          const syncOutputs = await step.run(`level-${lid}-sync`, async () => {
            const results: NodeRunOutput[] = [];
            await Promise.all(
              syncNodes.map(async (node) => {
                const nodeRunId = nodeRunIdMap[node.id];
                if (skippedNodeIds.has(node.id)) {
                  await updateWorkflowNodeRun(admin, nodeRunId, {
                    status: "skipped",
                    completed_at: new Date().toISOString(),
                  });
                  results.push({
                    nodeId: node.id,
                    nodeKey: node.node_key,
                    output: {},
                    skipped: true,
                    skippedDownstreamIds: (outgoingEdges.get(node.id) ?? []).map(
                      (e) => e.target_node_id
                    ),
                  });
                  return;
                }

                await updateWorkflowNodeRun(admin, nodeRunId, {
                  status: "running",
                  started_at: new Date().toISOString(),
                  input: context,
                });

                try {
                  const out = await execSyncNode(node, context, edges, outgoingEdges);
                  context[node.node_key] = out.output;
                  await updateWorkflowNodeRun(admin, nodeRunId, {
                    status: "completed",
                    output: out.output,
                    completed_at: new Date().toISOString(),
                  });
                  results.push({ ...out, nodeId: node.id });
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  await updateWorkflowNodeRun(admin, nodeRunId, {
                    status: "failed",
                    error: msg,
                    completed_at: new Date().toISOString(),
                  });
                  throw err;
                }
              })
            );
            return results;
          });

          for (const out of syncOutputs) {
            allOutputs.push(out);
            if (out.skipped) {
              skippedNodeIds.add(out.nodeId);
            }
            for (const downId of out.skippedDownstreamIds) {
              skippedNodeIds.add(downId);
            }
          }
        }

        // ── Subagent nodes: dispatch then poll with step.sleep (P1-1) ────
        for (const node of subagentNodes) {
          const nodeRunId = nodeRunIdMap[node.id];
          const shortId = node.id.slice(0, 8);

          if (skippedNodeIds.has(node.id)) {
            await step.run(`skip-subagent-${shortId}`, async () => {
              await updateWorkflowNodeRun(admin, nodeRunId, {
                status: "skipped",
                completed_at: new Date().toISOString(),
              });
            });
            allOutputs.push({
              nodeId: node.id,
              nodeKey: node.node_key,
              output: {},
              skipped: true,
              skippedDownstreamIds: (outgoingEdges.get(node.id) ?? []).map(
                (e) => e.target_node_id
              ),
            });
            skippedNodeIds.add(node.id);
            continue;
          }

          // Re-build context for this node (includes latest sync outputs).
          const nodeContext: Record<string, Record<string, unknown>> = { input: run.input };
          for (const out of allOutputs) {
            nodeContext[out.nodeKey] = out.output;
          }

          const cfg = node.config as unknown as SubagentNodeConfig;
          const task = resolveTemplate(cfg.task_template, nodeContext);

          // Dispatch step.
          const invocationId = await step.run(`dispatch-subagent-${shortId}`, async () => {
            const { data: skill } = await admin
              .from("skills")
              .select("id, workspace_id, subagent_tools, subagent_max_turns")
              .eq("id", cfg.skill_id)
              .maybeSingle();

            if (!skill || skill.workspace_id !== workspaceId) {
              throw new Error(`Skill ${cfg.skill_id} not found or inaccessible`);
            }

            await updateWorkflowNodeRun(admin, nodeRunId, {
              status: "running",
              started_at: new Date().toISOString(),
              input: nodeContext,
            });

            const subagent = await createSubagentInvocation(admin, {
              workspace_id: workspaceId,
              parent_operator_run_id: null,
              skill_id: cfg.skill_id,
              user_id: userId ?? "",
              task,
              depth: 1,
            });

            await updateWorkflowNodeRun(admin, nodeRunId, {
              subagent_invocation_id: subagent.id,
            });

            const { modalRunId } = await dispatchSubagentRun({
              invocationId: subagent.id,
              workspaceId,
              userId: userId ?? "",
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

            return subagent.id;
          });

          // Poll with step.sleep so Inngest can checkpoint between polls.
          const MAX_POLLS = 120; // 10 minutes at 5s each
          let nodeOutput: Record<string, unknown> = {};
          for (let poll = 0; poll < MAX_POLLS; poll++) {
            await step.sleep(`poll-${shortId}-${poll}`, "5s");

            const pollResult = await step.run(`check-${shortId}-${poll}`, async () => {
              const { data: row } = await admin
                .from("subagent_invocations")
                .select("status, output, error")
                .eq("id", invocationId)
                .maybeSingle();

              if (!row) throw new Error("Subagent invocation row disappeared");
              return {
                status: row.status as string,
                output: row.output as string | null,
                error: row.error as string | null,
              };
            });

            if (pollResult.status === "completed") {
              nodeOutput = { output: pollResult.output ?? "" };
              await updateWorkflowNodeRun(admin, nodeRunId, {
                status: "completed",
                output: nodeOutput,
                completed_at: new Date().toISOString(),
              });
              break;
            }
            if (pollResult.status === "failed") {
              await updateWorkflowNodeRun(admin, nodeRunId, {
                status: "failed",
                error: pollResult.error ?? "Subagent failed",
                completed_at: new Date().toISOString(),
              });
              throw new Error(`Subagent failed: ${pollResult.error ?? "unknown"}`);
            }
            if (pollResult.status === "cancelled") {
              await updateWorkflowNodeRun(admin, nodeRunId, {
                status: "failed",
                error: "Subagent was cancelled",
                completed_at: new Date().toISOString(),
              });
              throw new Error("Subagent was cancelled");
            }

            if (poll === MAX_POLLS - 1) {
              await updateWorkflowNodeRun(admin, nodeRunId, {
                status: "failed",
                error: "Subagent timed out after 10 minutes",
                completed_at: new Date().toISOString(),
              });
              throw new Error("Subagent timed out after 10 minutes");
            }
          }

          allOutputs.push({
            nodeId: node.id,
            nodeKey: node.node_key,
            output: nodeOutput,
            skipped: false,
            skippedDownstreamIds: [],
          });
        }
      }

      // ── 5. Collect final output from end node ────────────────────────
      const endNode = nodes.find((n) => n.node_type === "end");
      const endOutput = endNode
        ? allOutputs.find((o) => o.nodeId === endNode.id)?.output ?? {}
        : {};

      await step.run("mark-completed", () =>
        updateWorkflowRun(admin, runId, {
          status: "completed",
          output: endOutput,
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
