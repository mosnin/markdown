import type {
  WorkflowGraphInput,
  WorkflowGraphNodeInput,
  WorkflowNodeType,
} from "@/server/domain/types/workflow";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Fields on a node's config that may contain `{{nodeKey.path}}` template
 * references and must be validated against the node_key set.
 */
const TEMPLATE_FIELDS_BY_TYPE: Partial<Record<WorkflowNodeType, string[]>> = {
  subagent: ["task_template"],
  web_search: ["query_template"],
  web_fetch: ["url_template"],
  transform: ["user_prompt_template"],
  condition: ["expression"],
};

/**
 * Very limited DSL for condition expressions. Intentionally restrictive so
 * `eval` is never needed at runtime and RCE via injection is blocked.
 */
const CONDITION_EXPRESSION_RE =
  /^\s*{{[a-zA-Z0-9_]+\.[a-zA-Z0-9_.[\]]+}}\s*(==|!=|>|<|>=|<=)\s*("[^"]*"|\d+)\s*$/;

const TEMPLATE_NODE_KEY_RE = /{{\s*([a-zA-Z0-9_]+)\./gi;

export function validateWorkflowGraph(
  graph: WorkflowGraphInput
): ValidationResult {
  const errors: string[] = [];

  // ─── node_key uniqueness ─────────────────────────────────────────────
  const nodeKeys = new Set<string>();
  const duplicateKeys = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeKeys.has(node.node_key)) {
      duplicateKeys.add(node.node_key);
    } else {
      nodeKeys.add(node.node_key);
    }
  }
  for (const key of duplicateKeys) {
    errors.push(`Duplicate node_key "${key}" — node_keys must be unique within a workflow`);
  }

  // ─── Exactly one start node ──────────────────────────────────────────
  const startNodes = graph.nodes.filter((n) => n.node_type === "start");
  if (startNodes.length === 0) {
    errors.push("Workflow must have exactly one start node (found 0)");
  } else if (startNodes.length > 1) {
    errors.push(
      `Workflow must have exactly one start node (found ${startNodes.length})`
    );
  }

  // ─── Every edge endpoint resolves ────────────────────────────────────
  for (const edge of graph.edges) {
    if (!nodeKeys.has(edge.source_node_key)) {
      errors.push(
        `Edge references unknown source node_key "${edge.source_node_key}"`
      );
    }
    if (!nodeKeys.has(edge.target_node_key)) {
      errors.push(
        `Edge references unknown target node_key "${edge.target_node_key}"`
      );
    }
  }

  // ─── Acyclic check (Kahn's algorithm) ────────────────────────────────
  // Only consider edges whose endpoints exist to avoid noise from the
  // already-reported missing-endpoint errors.
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const key of nodeKeys) {
    inDegree.set(key, 0);
    outgoing.set(key, []);
  }
  for (const edge of graph.edges) {
    if (!nodeKeys.has(edge.source_node_key)) continue;
    if (!nodeKeys.has(edge.target_node_key)) continue;
    inDegree.set(
      edge.target_node_key,
      (inDegree.get(edge.target_node_key) ?? 0) + 1
    );
    outgoing.get(edge.source_node_key)!.push(edge.target_node_key);
  }
  const queue: string[] = [];
  for (const [key, deg] of inDegree) {
    if (deg === 0) queue.push(key);
  }
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited++;
    for (const next of outgoing.get(current) ?? []) {
      const newDeg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }
  if (visited < nodeKeys.size) {
    errors.push("Workflow graph contains a cycle — only DAGs are allowed");
  }

  // ─── Per-node config validation ──────────────────────────────────────
  for (const node of graph.nodes) {
    validateNodeConfig(node, errors);
  }

  // ─── Template reference resolution ───────────────────────────────────
  for (const node of graph.nodes) {
    const fields = TEMPLATE_FIELDS_BY_TYPE[node.node_type];
    if (!fields) continue;
    for (const field of fields) {
      const raw = (node.config as Record<string, unknown>)[field];
      if (typeof raw !== "string") continue;
      TEMPLATE_NODE_KEY_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = TEMPLATE_NODE_KEY_RE.exec(raw)) !== null) {
        const referencedKey = match[1];
        if (!nodeKeys.has(referencedKey)) {
          errors.push(
            `Node "${node.node_key}" ${field} references unknown node "${referencedKey}"`
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateNodeConfig(
  node: WorkflowGraphNodeInput,
  errors: string[]
): void {
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  const label = `Node "${node.node_key}" (${node.node_type})`;

  switch (node.node_type) {
    case "subagent": {
      const skillId = cfg.skill_id;
      const taskTemplate = cfg.task_template;
      if (typeof skillId !== "string" || skillId.trim().length === 0) {
        errors.push(`${label}: config.skill_id must be a non-empty string`);
      }
      if (typeof taskTemplate !== "string") {
        errors.push(`${label}: config.task_template must be a string`);
      }
      break;
    }
    case "web_search": {
      const queryTemplate = cfg.query_template;
      const provider = cfg.provider;
      const numResults = cfg.num_results;
      if (typeof queryTemplate !== "string") {
        errors.push(`${label}: config.query_template must be a string`);
      }
      if (provider !== "exa" && provider !== "tavily") {
        errors.push(`${label}: config.provider must be "exa" or "tavily"`);
      }
      if (
        typeof numResults !== "number" ||
        !Number.isInteger(numResults) ||
        numResults < 1 ||
        numResults > 25
      ) {
        errors.push(
          `${label}: config.num_results must be an integer between 1 and 25`
        );
      }
      break;
    }
    case "web_fetch": {
      const urlTemplate = cfg.url_template;
      if (typeof urlTemplate !== "string") {
        errors.push(`${label}: config.url_template must be a string`);
      }
      break;
    }
    case "transform": {
      const systemPrompt = cfg.system_prompt;
      const userPromptTemplate = cfg.user_prompt_template;
      if (typeof systemPrompt !== "string" || systemPrompt.trim().length === 0) {
        errors.push(
          `${label}: config.system_prompt must be a non-empty string`
        );
      }
      if (
        typeof userPromptTemplate !== "string" ||
        userPromptTemplate.trim().length === 0
      ) {
        errors.push(
          `${label}: config.user_prompt_template must be a non-empty string`
        );
      }
      break;
    }
    case "condition": {
      const expression = cfg.expression;
      if (typeof expression !== "string") {
        errors.push(`${label}: config.expression must be a string`);
      } else if (!CONDITION_EXPRESSION_RE.test(expression)) {
        errors.push(
          `${label}: config.expression does not match the supported DSL ` +
            `({{nodeKey.path}} <op> "literal"|number)`
        );
      }
      break;
    }
    case "start":
    case "merge":
    case "end": {
      // Empty config required — no required fields, extra keys tolerated
      // but we don't bother with a strict assertion here.
      break;
    }
    default: {
      // Exhaustiveness guard for future node types.
      const _exhaustive: never = node.node_type;
      void _exhaustive;
      errors.push(`${label}: unknown node_type`);
    }
  }
}
