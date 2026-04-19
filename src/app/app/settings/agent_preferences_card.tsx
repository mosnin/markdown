"use client";

import { useState, useEffect } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  saveUserAgentPreferencesAction,
  type SaveUserAgentPreferencesInput,
} from "./agent_preferences_actions";
import {
  AGENT_TOOL_NAMES,
  type AgentToolName,
  type AgentTone,
  type CitationStyle,
} from "@/server/services/user_agent_preferences_service";

// ─── Vocabulary ──────────────────────────────────────────────────────────────

const TONE_OPTIONS: ReadonlyArray<{ value: AgentTone; label: string }> = [
  { value: "neutral", label: "Neutral" },
  { value: "formal", label: "Formal" },
  { value: "casual", label: "Casual" },
  { value: "technical", label: "Technical" },
  { value: "friendly", label: "Friendly" },
];

const CITATION_OPTIONS: ReadonlyArray<{ value: CitationStyle; label: string }> = [
  { value: "inline", label: "Inline ([note])" },
  { value: "footnote", label: "Footnotes" },
  { value: "endnote", label: "Endnotes" },
];

const TOOL_LABELS: Record<AgentToolName, string> = {
  hybrid_search: "Hybrid search",
  draft_note: "Draft note",
  read_note: "Read note",
  edit_note: "Edit note",
  link_notes: "Link notes",
  apply_template: "Apply template",
  web_fetch: "Fetch web pages",
};

// ─── Component ──────────────────────────────────────────────────────────────

export interface AgentPreferencesCardProps {
  initialPrefs: SaveUserAgentPreferencesInput;
}

export function AgentPreferencesCard({ initialPrefs }: AgentPreferencesCardProps) {
  const [prefs, setPrefs] = useState<SaveUserAgentPreferencesInput>(initialPrefs);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (status === "saved") {
      const t = setTimeout(() => setStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [status]);

  function setTone(tone: AgentTone) {
    setPrefs((p) => ({ ...p, tone }));
    setStatus("idle");
  }
  function setCitation(citation_style: CitationStyle) {
    setPrefs((p) => ({ ...p, citation_style }));
    setStatus("idle");
  }
  function toggleTool(tool: AgentToolName) {
    setPrefs((p) => {
      const has = p.tool_allowlist.includes(tool);
      const next = has
        ? p.tool_allowlist.filter((t) => t !== tool)
        : [...p.tool_allowlist, tool];
      return { ...p, tool_allowlist: next };
    });
    setStatus("idle");
  }
  function toggleStrictCitation() {
    setPrefs((p) => ({ ...p, must_cite_per_claim: !p.must_cite_per_claim }));
    setStatus("idle");
  }
  function setMaxToolCalls(value: number) {
    setPrefs((p) => ({
      ...p,
      max_tool_calls: Math.max(1, Math.min(100, Math.floor(value || 0))),
    }));
    setStatus("idle");
  }

  async function handleSave() {
    setStatus("saving");
    setErrorMsg("");
    const result = await saveUserAgentPreferencesAction(prefs);
    if (result.ok) {
      setStatus("saved");
    } else {
      setStatus("error");
      setErrorMsg(result.error);
    }
  }

  return (
    <Card id="settings-agent-preferences">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          AI Agent Preferences
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          How the Workspace Operator should behave on your runs. These
          settings apply across every workspace you participate in.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-5">
        {/* Tone */}
        <div className="space-y-2">
          <label
            htmlFor="agent-tone"
            className="text-sm font-medium text-foreground"
          >
            Tone
          </label>
          <p className="text-xs text-muted-foreground">
            Voice the agent uses when drafting prose.
          </p>
          <select
            id="agent-tone"
            data-testid="agent-tone-select"
            value={prefs.tone}
            onChange={(e) => setTone(e.target.value as AgentTone)}
            className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {TONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Citation style */}
        <div className="space-y-2">
          <label
            htmlFor="agent-citation"
            className="text-sm font-medium text-foreground"
          >
            Citation style
          </label>
          <p className="text-xs text-muted-foreground">
            How references back to source notes are rendered.
          </p>
          <select
            id="agent-citation"
            data-testid="agent-citation-select"
            value={prefs.citation_style}
            onChange={(e) => setCitation(e.target.value as CitationStyle)}
            className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {CITATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Tool allowlist */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Allowed tools</p>
          <p className="text-xs text-muted-foreground">
            Tools the agent may call. Disabling a tool removes it from the
            agent&apos;s toolbelt for your runs.
          </p>
          <div className="flex flex-col gap-1">
            {AGENT_TOOL_NAMES.map((tool) => {
              const checked = prefs.tool_allowlist.includes(tool);
              return (
                <label
                  key={tool}
                  htmlFor={`tool-${tool}`}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/30 transition-colors"
                >
                  <span className="text-sm text-foreground">
                    {TOOL_LABELS[tool]}
                  </span>
                  <input
                    id={`tool-${tool}`}
                    data-testid={`tool-${tool}`}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTool(tool)}
                    className="accent-foreground"
                  />
                </label>
              );
            })}
          </div>
        </div>

        {/* Strict citation toggle */}
        <label
          htmlFor="strict-citation"
          className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border px-4 py-3 hover:bg-muted/30 transition-colors"
        >
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">
              Strict citation mode
            </p>
            <p className="text-xs text-muted-foreground">
              Require a citation on every factual claim. Drafts that
              can&apos;t be sourced will fail rather than hallucinate.
            </p>
          </div>
          <input
            id="strict-citation"
            data-testid="strict-citation-switch"
            type="checkbox"
            checked={prefs.must_cite_per_claim}
            onChange={toggleStrictCitation}
            className="mt-0.5 shrink-0 accent-foreground"
            role="switch"
            aria-checked={prefs.must_cite_per_claim}
          />
        </label>

        {/* Max tool calls */}
        <div className="space-y-2">
          <label
            htmlFor="max-tool-calls"
            className="text-sm font-medium text-foreground"
          >
            Max tool calls per run
          </label>
          <p className="text-xs text-muted-foreground">
            Hard cap on the agent loop. Keeps a single run from running
            away with cost. Range 1 – 100.
          </p>
          <Input
            id="max-tool-calls"
            data-testid="max-tool-calls-input"
            type="number"
            min={1}
            max={100}
            value={prefs.max_tool_calls}
            onChange={(e) => setMaxToolCalls(Number(e.target.value))}
            className="w-24"
          />
        </div>

        {/* Save */}
        <div className="flex items-center justify-end gap-3 pt-1">
          {status === "saved" && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="agent-prefs-saved"
            >
              Preferences saved.
            </p>
          )}
          {status === "error" && (
            <p
              className="text-xs text-destructive"
              data-testid="agent-prefs-error"
            >
              {errorMsg}
            </p>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={status === "saving"}
            data-testid="agent-prefs-save"
          >
            {status === "saving" ? "Saving..." : "Save preferences"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
