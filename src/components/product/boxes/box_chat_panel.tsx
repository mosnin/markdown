"use client";

import { useState } from "react";
import { Bot, ChevronUp, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceConversation } from "@/components/product/workspace_conversation";
import { startConversationTurnAction } from "@/app/app/conversation/actions";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BoxChatPanelProps {
  workspaceId: string;
  boxId: string;
  boxName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Pinned bottom panel that provides a scoped chat interface for a specific
 * box. When expanded the user can ask Pog questions that are answered using
 * context only from the box's notes. The active run streams back via the
 * existing Supabase realtime channel through WorkspaceConversation.
 */
export function BoxChatPanel({ workspaceId, boxId, boxName }: BoxChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const p = prompt.trim();
    if (!p || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await startConversationTurnAction({ prompt: p, boxId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setActiveRunId(result.data.runId);
      setPrompt("");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background shadow-lg"
      style={{ marginLeft: "var(--sidebar-width, 240px)" }}
    >
      {/* Toggle bar */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-2">
          <Bot className="h-4 w-4" />
          Ask Pog about {boxName}
        </span>
        <ChevronUp
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="flex flex-col" style={{ maxHeight: "40vh" }}>
          {/* Conversation stream */}
          <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
            <WorkspaceConversation
              workspaceId={workspaceId}
              initialRuns={[]}
              nowIso={new Date().toISOString()}
              activeRunId={activeRunId}
              userDisplayName={null}
            />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border px-4 py-2">
            {error && (
              <p className="mb-1 text-xs text-red-500">{error}</p>
            )}
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={`Ask about ${boxName}…`}
                disabled={pending}
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
              <Button
                type="submit"
                size="sm"
                disabled={pending || !prompt.trim()}
              >
                {pending ? (
                  <Spinner size={14} />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
