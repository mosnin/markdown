"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  Save,
  Play,
  Plus,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Workflow, WorkflowNodeType } from "@/server/domain/types/workflow";
import {
  saveWorkflowAction,
  runWorkflowAction,
} from "@/app/app/workflows/actions";

// ─── Node type icons / labels ─────────────────────────────────────────────────

const NODE_TYPE_META: Record<
  WorkflowNodeType,
  { label: string; icon: string; color: string }
> = {
  start: { label: "Start", icon: "▶", color: "bg-emerald-500/10 border-emerald-500/40 text-emerald-700" },
  subagent: { label: "Sub-agent", icon: "🤖", color: "bg-violet-500/10 border-violet-500/40 text-violet-700" },
  web_search: { label: "Web Search", icon: "🔍", color: "bg-blue-500/10 border-blue-500/40 text-blue-700" },
  web_fetch: { label: "Web Fetch", icon: "🌐", color: "bg-sky-500/10 border-sky-500/40 text-sky-700" },
  transform: { label: "Transform", icon: "⚡", color: "bg-amber-500/10 border-amber-500/40 text-amber-700" },
  condition: { label: "Condition", icon: "◇", color: "bg-orange-500/10 border-orange-500/40 text-orange-700" },
  merge: { label: "Merge", icon: "⬡", color: "bg-pink-500/10 border-pink-500/40 text-pink-700" },
  end: { label: "End", icon: "⏹", color: "bg-rose-500/10 border-rose-500/40 text-rose-700" },
};

// ─── Custom node components ───────────────────────────────────────────────────

function makeCustomNode(nodeType: WorkflowNodeType) {
  const meta = NODE_TYPE_META[nodeType];
  // eslint-disable-next-line react/display-name
  return function CustomNode({ data }: { data: { node_key: string; config: Record<string, unknown> } }) {
    return (
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-xs font-medium shadow-sm min-w-[120px]",
          meta.color
        )}
      >
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true">{meta.icon}</span>
          <span className="font-semibold">{meta.label}</span>
        </div>
        <div className="mt-0.5 truncate text-[10px] opacity-70">{data.node_key}</div>
      </div>
    );
  };
}

const nodeTypes: NodeTypes = {
  start: makeCustomNode("start"),
  subagent: makeCustomNode("subagent"),
  web_search: makeCustomNode("web_search"),
  web_fetch: makeCustomNode("web_fetch"),
  transform: makeCustomNode("transform"),
  condition: makeCustomNode("condition"),
  merge: makeCustomNode("merge"),
  end: makeCustomNode("end"),
};

// ─── Conversion helpers ───────────────────────────────────────────────────────

function workflowToRFNodes(workflow: Workflow): Node[] {
  return (workflow.graph?.nodes ?? []).map((n) => ({
    id: n.id,
    type: n.node_type,
    position: n.position,
    data: { node_key: n.node_key, config: n.config },
  }));
}

function workflowToRFEdges(workflow: Workflow): Edge[] {
  return (workflow.graph?.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    sourceHandle: e.source_handle ?? undefined,
    label: e.label ?? undefined,
  }));
}

// ─── Main canvas component ────────────────────────────────────────────────────

interface WorkflowCanvasProps {
  workflow: Workflow;
}

export function WorkflowCanvas({ workflow }: WorkflowCanvasProps) {
  const router = useRouter();
  const [name, setName] = useState(workflow.name);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const initialNodes = useMemo(() => workflowToRFNodes(workflow), [workflow]);
  const initialEdges = useMemo(() => workflowToRFEdges(workflow), [workflow]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    setValidationErrors([]);

    // Build a node_key lookup from current RF node data
    const nodeKeyById = new Map<string, string>();
    for (const node of nodes) {
      const nodeKey = (node.data as { node_key: string }).node_key;
      nodeKeyById.set(node.id, nodeKey);
    }

    const graphInput = {
      nodes: nodes.map((node) => ({
        id: node.id,
        node_key: (node.data as { node_key: string }).node_key,
        node_type: node.type as WorkflowNodeType,
        position: node.position,
        config: (node.data as { config: Record<string, unknown> }).config ?? {},
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source_node_key: nodeKeyById.get(edge.source) ?? edge.source,
        target_node_key: nodeKeyById.get(edge.target) ?? edge.target,
        source_handle: edge.sourceHandle ?? null,
        label: typeof edge.label === "string" ? edge.label : null,
      })),
    };

    const result = await saveWorkflowAction(workflow.id, {
      name,
      graph: graphInput,
    });

    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      if ("validationErrors" in result && result.validationErrors) {
        setValidationErrors(result.validationErrors);
      }
    }
  }, [workflow.id, name, nodes, edges]);

  // ── Run ─────────────────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    const result = await runWorkflowAction(workflow.id);
    setIsRunning(false);
    if (result.ok) {
      router.push(`/app/workflows/${workflow.id}/runs`);
    } else {
      setSaveError(result.error);
    }
  }, [workflow.id, router]);

  // ── Add node ────────────────────────────────────────────────────────────────

  const addNode = useCallback(
    (nodeType: WorkflowNodeType) => {
      const typeCount = nodes.filter((n) => n.type === nodeType).length;
      const nodeKey = `${nodeType}_${typeCount + 1}`;
      const newNode: Node = {
        id: `${nodeType}-${Date.now()}`,
        type: nodeType,
        position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
        data: { node_key: nodeKey, config: {} },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [nodes, setNodes]
  );

  const nodeTypeList: WorkflowNodeType[] = [
    "start",
    "subagent",
    "web_search",
    "web_fetch",
    "transform",
    "condition",
    "merge",
    "end",
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-4 py-2">
        <Link
          href="/app/workflows"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Workflows
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-foreground transition-colors hover:border-border focus:border-ring focus:outline-none"
          aria-label="Workflow name"
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground",
              "transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Save
          </button>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground",
              "transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Run
          </button>
        </div>
      </div>

      {/* Validation / error banners */}
      {(saveError || validationErrors.length > 0) && (
        <div className="flex shrink-0 flex-col gap-1 border-b border-rose-200 bg-rose-50 px-4 py-2 dark:border-rose-900/40 dark:bg-rose-950/20">
          {saveError && (
            <p className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {saveError}
            </p>
          )}
          {validationErrors.map((err, i) => (
            <p
              key={i}
              className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {err}
            </p>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Add node panel */}
        <aside className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card px-3 py-3">
          <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Plus className="h-3 w-3" aria-hidden="true" />
            Add node
          </p>
          {nodeTypeList.map((nt) => {
            const meta = NODE_TYPE_META[nt];
            return (
              <button
                key={nt}
                onClick={() => addNode(nt)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs font-medium",
                  "transition-colors hover:opacity-80",
                  meta.color
                )}
              >
                <span aria-hidden="true">{meta.icon}</span>
                {meta.label}
              </button>
            );
          })}
        </aside>

        {/* React Flow canvas */}
        <div className="min-h-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
