"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type Agent } from "@/server/domain/types/agent";
import { cn } from "@/lib/utils";

// ─── Derived export generators ────────────────────────────────────────────────

function buildStructuredJson(agent: Agent): string {
  const obj: Record<string, unknown> = { name: agent.name };
  if (agent.description) obj.description = agent.description;
  if (agent.agent_type) obj.agent_type = agent.agent_type;
  if (agent.model_hint) obj.model_hint = agent.model_hint;
  if (agent.tags.length > 0) obj.tags = agent.tags;
  if (agent.system_prompt) obj.system_prompt = agent.system_prompt;
  return JSON.stringify(obj, null, 2);
}

function buildStructuredYaml(agent: Agent): string {
  const lines: string[] = [];
  lines.push(`name: ${yamlStr(agent.name)}`);
  if (agent.description) lines.push(`description: ${yamlStr(agent.description)}`);
  if (agent.agent_type) lines.push(`agent_type: ${agent.agent_type}`);
  if (agent.model_hint) lines.push(`model_hint: ${yamlStr(agent.model_hint)}`);
  if (agent.tags.length > 0) {
    lines.push("tags:");
    for (const t of agent.tags) lines.push(`  - ${yamlStr(t)}`);
  }
  if (agent.system_prompt) {
    lines.push("system_prompt: |");
    for (const line of agent.system_prompt.split("\n")) {
      lines.push(`  ${line}`);
    }
  }
  return lines.join("\n");
}

function yamlStr(value: string): string {
  if (/[:#\[\]{}|>&*!,'"\\]/.test(value) || value.includes("\n")) {
    return JSON.stringify(value);
  }
  return value;
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-fast",
        "text-muted-foreground hover:text-foreground hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
      ) : (
        <Copy className="h-3 w-3" aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ─── Export block ─────────────────────────────────────────────────────────────

function ExportBlock({
  label,
  format,
  content,
}: {
  label: string;
  format: string;
  content: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-foreground">{label}</h3>
          <span className="rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {format}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground/50 select-none">read only</span>
          <CopyButton text={content} />
        </div>
      </div>
      <pre
        className={cn(
          "overflow-auto rounded-md border border-border bg-muted/20 p-3",
          "font-mono text-[11px] leading-5 text-foreground/80",
          "max-h-64 whitespace-pre-wrap break-words"
        )}
        aria-label={`${label} export`}
      >
        {content}
      </pre>
    </section>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface AgentExportsPanelProps {
  agent: Agent;
}

/**
 * Exports tab for Agents.
 *
 * Shows read-only generated representations derived from the agent's structured
 * core fields (name, description, agent_type, model_hint, system_prompt, tags).
 *
 * These are NOT editable. They are derived from the agent model and regenerated
 * on each page load. Editing must be done via the Source tab.
 */
export function AgentExportsPanel({ agent }: AgentExportsPanelProps) {
  const jsonExport = buildStructuredJson(agent);
  const yamlExport = buildStructuredYaml(agent);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 px-6 py-6">
        {/* Banner */}
        <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            These views are generated from the agent's structured metadata and are{" "}
            <strong className="font-medium">read only</strong>. To change the canonical
            source, use the <span className="font-medium">Source</span> tab.
          </p>
        </div>

        <ExportBlock
          label="Structured summary"
          format="json"
          content={jsonExport}
        />

        <ExportBlock
          label="Structured summary"
          format="yaml"
          content={yamlExport}
        />
      </div>
    </ScrollArea>
  );
}
