"use client";

import { useState, useTransition } from "react";
import { Play, Loader2 } from "lucide-react";
import { startConversationTurnAction } from "@/app/app/conversation/actions";

interface SkillTestSandboxProps {
  skill: {
    id: string;
    name: string;
    source_content: string | null;
  };
  defaultBoxId: string | null;
}

export function SkillTestSandbox({ skill, defaultBoxId }: SkillTestSandboxProps) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const params = detectParameters(skill.source_content ?? "");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  function buildPrompt(sampleInput: string): string {
    const skillContent = skill.source_content ?? skill.name;
    if (sampleInput.trim()) {
      return `Apply the following skill to the provided input.\n\n## Skill: ${skill.name}\n\n${skillContent}\n\n## Input\n\n${sampleInput}`;
    }
    return `Run the following skill:\n\n## Skill: ${skill.name}\n\n${skillContent}`;
  }

  function resolvedInput(): string {
    let text = input;
    for (const [key, val] of Object.entries(paramValues)) {
      text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
    }
    return text;
  }

  function handleRun() {
    if (isPending) return;
    setOutput(null);
    startTransition(async () => {
      const result = await startConversationTurnAction({
        prompt: buildPrompt(resolvedInput()),
        boxId: defaultBoxId,
      });
      if (result.ok) {
        setRunId(result.data.runId);
        setOutput(`Run started — view in workspace conversation (run ID: ${result.data.runId})`);
      } else {
        setOutput(`Error: ${result.error}`);
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Test this skill</h2>
        <p className="text-xs text-muted-foreground">
          Paste sample content, then run the skill to see how it performs.
        </p>
      </div>

      {params.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Parameters</p>
          {params.map((param) => (
            <div key={param} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-foreground">{param}</label>
              <input
                type="text"
                value={paramValues[param] ?? ""}
                onChange={(e) => setParamValues((prev) => ({ ...prev, [param]: e.target.value }))}
                placeholder={`Value for {{${param}}}`}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-foreground">Sample input</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste text to apply this skill to... (optional)"
          rows={6}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y font-mono"
        />
      </div>

      <button
        onClick={handleRun}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {isPending ? "Running…" : "Run skill"}
      </button>

      {output && (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Result</p>
          <p className="text-sm text-foreground">{output}</p>
          {runId && (
            <a
              href="/app"
              className="mt-2 inline-flex text-xs text-violet-600 hover:underline"
            >
              View full output in workspace →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function detectParameters(content: string): string[] {
  const matches = content.matchAll(/\{\{(\w+)\}\}/g);
  const params = new Set<string>();
  for (const match of matches) {
    params.add(match[1]);
  }
  return [...params];
}
