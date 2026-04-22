"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  X,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { describeCron } from "@/lib/cron";
import type { Workflow, WorkflowNodeType } from "@/server/domain/types/workflow";
import {
  saveWorkflowAction,
  runWorkflowAction,
  setWorkflowScheduleAction,
  clearWorkflowScheduleAction,
  getWorkflowScheduleAction,
  type WorkflowScheduleInfo,
} from "@/app/app/workflows/actions";
import { listSkillsForSlashMenuAction } from "@/app/app/notes/inline_command_actions";

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

// ─── Config panel types ───────────────────────────────────────────────────────

type SkillOption = { id: string; name: string };

// ─── Config panel component ───────────────────────────────────────────────────

interface NodeConfigPanelProps {
  node: Node;
  onClose: () => void;
  onApply: (nodeId: string, config: Record<string, unknown>) => void;
}

function NodeConfigPanel({ node, onClose, onApply }: NodeConfigPanelProps) {
  const nodeType = node.type as WorkflowNodeType;
  const initialConfig = (node.data as { config: Record<string, unknown> }).config ?? {};
  const nodeKey = (node.data as { node_key: string }).node_key;
  const meta = NODE_TYPE_META[nodeType];

  const [config, setConfig] = useState<Record<string, unknown>>(initialConfig);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);

  // Reset local config when the selected node changes — derived state from
  // props pattern (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  const [prevNodeId, setPrevNodeId] = useState<string>(node.id);
  if (prevNodeId !== node.id) {
    setPrevNodeId(node.id);
    setConfig(initialConfig);
  }

  // Load skills for subagent nodes
  useEffect(() => {
    if (nodeType !== "subagent") return;
    let cancelled = false;
    listSkillsForSlashMenuAction().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSkills(result.data.map((s) => ({ id: s.id, name: s.name })));
      }
      setSkillsLoaded(true);
    });
    return () => { cancelled = true; };
  }, [nodeType]);

  const setField = useCallback((key: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleApply = useCallback(() => {
    onApply(node.id, config);
  }, [node.id, config, onApply]);

  const inputClass =
    "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none";
  const labelClass = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

  function renderFields() {
    switch (nodeType) {
      case "start":
      case "merge":
      case "end":
        return (
          <p className="text-xs text-muted-foreground italic">No configuration needed.</p>
        );

      case "subagent": {
        const skillId = (config.skill_id as string) ?? "";
        const taskTemplate = (config.task_template as string) ?? "";
        const showSelect = skillsLoaded && skills.length > 0;
        return (
          <>
            <div>
              <label className={labelClass}>Skill / Agent</label>
              {!skillsLoaded ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Loading skills…
                </div>
              ) : showSelect ? (
                <select
                  value={skillId}
                  onChange={(e) => setField("skill_id", e.target.value)}
                  className={inputClass}
                >
                  <option value="">— select a skill —</option>
                  {skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={skillId}
                  onChange={(e) => setField("skill_id", e.target.value)}
                  placeholder="skill-id"
                  className={inputClass}
                />
              )}
            </div>
            <div>
              <label className={labelClass}>Task template</label>
              <textarea
                value={taskTemplate}
                onChange={(e) => setField("task_template", e.target.value)}
                placeholder="Describe what the agent should do. Use {{variable}} for inputs from previous nodes."
                rows={5}
                className={cn(inputClass, "resize-y")}
              />
            </div>
          </>
        );
      }

      case "web_search": {
        const queryTemplate = (config.query_template as string) ?? "";
        const provider = (config.provider as string) ?? "exa";
        const numResults = (config.num_results as number) ?? 5;
        return (
          <>
            <div>
              <label className={labelClass}>Query template</label>
              <input
                type="text"
                value={queryTemplate}
                onChange={(e) => setField("query_template", e.target.value)}
                placeholder="Search query or {{variable}}"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Provider</label>
              <select
                value={provider}
                onChange={(e) => setField("provider", e.target.value)}
                className={inputClass}
              >
                <option value="exa">Exa</option>
                <option value="tavily">Tavily</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Number of results</label>
              <input
                type="number"
                min={1}
                max={20}
                value={numResults}
                onChange={(e) => setField("num_results", parseInt(e.target.value, 10) || 1)}
                className={inputClass}
              />
            </div>
          </>
        );
      }

      case "web_fetch": {
        const urlTemplate = (config.url_template as string) ?? "";
        return (
          <div>
            <label className={labelClass}>URL template</label>
            <input
              type="text"
              value={urlTemplate}
              onChange={(e) => setField("url_template", e.target.value)}
              placeholder="https://example.com or {{variable}}"
              className={inputClass}
            />
          </div>
        );
      }

      case "transform": {
        const systemPrompt = (config.system_prompt as string) ?? "";
        const userPromptTemplate = (config.user_prompt_template as string) ?? "";
        const model = (config.model as string) ?? "";
        return (
          <>
            <div>
              <label className={labelClass}>System prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setField("system_prompt", e.target.value)}
                placeholder="You are a helpful assistant..."
                rows={4}
                className={cn(inputClass, "resize-y")}
              />
            </div>
            <div>
              <label className={labelClass}>User prompt template</label>
              <textarea
                value={userPromptTemplate}
                onChange={(e) => setField("user_prompt_template", e.target.value)}
                placeholder="Transform this: {{input}}"
                rows={4}
                className={cn(inputClass, "resize-y")}
              />
            </div>
            <div>
              <label className={labelClass}>Model</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setField("model", e.target.value)}
                defaultValue="gpt-4o"
                placeholder="gpt-4o"
                className={inputClass}
              />
            </div>
          </>
        );
      }

      case "condition": {
        const expression = (config.expression as string) ?? "";
        return (
          <div>
            <label className={labelClass}>Expression</label>
            <input
              type="text"
              value={expression}
              onChange={(e) => setField("expression", e.target.value)}
              placeholder="{{result}} contains 'success'"
              className={inputClass}
            />
          </div>
        );
      }

      default:
        return null;
    }
  }

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-border bg-card">
      {/* Panel header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <span aria-hidden="true" className="text-base">{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">{meta.label}</p>
          <p className="truncate text-[10px] text-muted-foreground">{nodeKey}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close config panel"
          className="ml-auto flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>

      {/* Fields */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        {renderFields()}
      </div>

      {/* Apply button */}
      <div className="shrink-0 border-t border-border px-3 py-2.5">
        <button
          onClick={handleApply}
          className={cn(
            "w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground",
            "transition-colors hover:bg-primary/90"
          )}
        >
          Apply
        </button>
      </div>
    </aside>
  );
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

  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onApplyConfig = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, config } }
            : n
        )
      );
      // Keep the selected node reference in sync with the updated data
      setSelectedNode((prev) =>
        prev && prev.id === nodeId
          ? { ...prev, data: { ...prev.data, config } }
          : prev
      );
    },
    [setNodes]
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
            onClick={() => setScheduleOpen(true)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground",
              "transition-colors hover:bg-accent"
            )}
            aria-label="Schedule workflow"
          >
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Schedule
          </button>
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
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Node config panel */}
        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            onClose={onClosePanel}
            onApply={onApplyConfig}
          />
        )}
      </div>

      {/* Schedule dialog */}
      {scheduleOpen && (
        <ScheduleDialog
          workflowId={workflow.id}
          onClose={() => setScheduleOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Schedule dialog ──────────────────────────────────────────────────────────

interface ScheduleDialogProps {
  workflowId: string;
  onClose: () => void;
}

function ScheduleDialog({ workflowId, onClose }: ScheduleDialogProps) {
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<WorkflowScheduleInfo | null>(null);
  const [cron, setCron] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the current schedule when the dialog opens. `loading` starts true
  // and the dialog is mounted fresh per open, so no sync setLoading needed.
  useEffect(() => {
    let cancelled = false;
    getWorkflowScheduleAction(workflowId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setCurrent(result.trigger);
        if (result.trigger) {
          setCron(result.trigger.cron_expression ?? "");
          setEnabled(result.trigger.is_enabled);
        } else {
          setCron("");
          setEnabled(true);
        }
      } else {
        setError(result.error);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  // Live validation of the cron expression — only when non-empty.
  const validation = useMemo(() => {
    if (!cron.trim()) return null;
    return describeCron(cron);
  }, [cron]);

  const canSave =
    !saving &&
    !loading &&
    validation !== null &&
    validation.ok === true;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    const result = await setWorkflowScheduleAction(workflowId, cron, enabled);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Refresh current state from server.
    const refreshed = await getWorkflowScheduleAction(workflowId);
    if (refreshed.ok) {
      setCurrent(refreshed.trigger);
    }
  }, [workflowId, cron, enabled]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    setError(null);
    const result = await clearWorkflowScheduleAction(workflowId);
    setClearing(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCurrent(null);
    setCron("");
    setEnabled(true);
  }, [workflowId]);

  const inputClass =
    "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none";
  const labelClass =
    "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Schedule workflow"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="flex-1 text-sm font-semibold text-foreground">
            Schedule
          </h2>
          <button
            onClick={onClose}
            aria-label="Close schedule dialog"
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-4 py-4">
          {loading ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Loading schedule…
            </div>
          ) : (
            <>
              {/* Current state */}
              <div className="rounded-md border border-border bg-background px-3 py-2 text-xs">
                {current && current.cron_expression ? (
                  <CurrentScheduleSummary
                    expression={current.cron_expression}
                    isEnabled={current.is_enabled}
                  />
                ) : (
                  <span className="text-muted-foreground">No schedule</span>
                )}
              </div>

              {/* Cron input */}
              <div>
                <label className={labelClass} htmlFor="cron-input">
                  Cron expression (UTC)
                </label>
                <input
                  id="cron-input"
                  type="text"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 9 * * 1"
                  className={inputClass}
                  autoComplete="off"
                  spellCheck={false}
                />
                {validation !== null && (
                  <p
                    className={cn(
                      "mt-1 text-[11px]",
                      validation.ok
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    )}
                  >
                    {validation.ok ? validation.description : validation.error}
                  </p>
                )}
                <div className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
                  <p>Every hour: <code>0 * * * *</code></p>
                  <p>Weekdays 9am UTC: <code>0 9 * * 1-5</code></p>
                  <p>Daily at midnight UTC: <code>0 0 * * *</code></p>
                </div>
              </div>

              {/* Enabled toggle */}
              <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                Enabled
              </label>

              {error && (
                <p className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <div>
            {current && (
              <button
                onClick={handleClear}
                disabled={clearing || saving}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground",
                  "transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                )}
              >
                {clearing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                Remove schedule
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className={cn(
                "inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground",
                "transition-colors hover:bg-accent"
              )}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground",
                "transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              Save schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CurrentScheduleSummary({
  expression,
  isEnabled,
}: {
  expression: string;
  isEnabled: boolean;
}) {
  const v = describeCron(expression);
  const desc = v.ok ? v.description : expression;
  return (
    <span className="text-foreground">
      Runs: <span className="font-medium">{desc}</span>{" "}
      <span
        className={cn(
          "ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
          isEnabled
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : "bg-muted text-muted-foreground"
        )}
      >
        {isEnabled ? "Enabled" : "Paused"}
      </span>
    </span>
  );
}
