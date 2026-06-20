"use client";

import * as React from "react";
import { ArrowUp, PanelLeft, Plus, Sparkles, Square } from "lucide-react";

import { cn } from "@/lib/utils";

// ─── ChatGPT-style assistant ─────────────────────────────────────────────────
//
// A clean, streaming chat that talks to OpenRouter via /api/chat. No operator
// sandbox, no agent loop, no modal — just a message thread and a composer.
// Session history is hidden by default behind a toggle (in-memory for now).

type Role = "user" | "assistant";
interface Message {
  id: string;
  role: Role;
  content: string;
}

const SUGGESTIONS = [
  "Summarize my latest notes",
  "Draft an outline for a new doc",
  "What should I write about next?",
  "Turn these bullet points into prose",
];

function uid() {
  return Math.random().toString(36).slice(2);
}

export function AiChat() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [showSidebar, setShowSidebar] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const patchLast = React.useCallback((content: string) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], content };
      return next;
    });
  }, []);

  const send = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      const history = [...messages, { id: uid(), role: "user" as const, content: trimmed }];
      setMessages([...history, { id: uid(), role: "assistant", content: "" }]);
      setInput("");
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, content: m.content })),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => null);
          patchLast(err?.error ?? "Something went wrong. Please try again.");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          patchLast(acc);
        }
        if (!acc) patchLast("(no response)");
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") {
          patchLast("Network error — please try again.");
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming, patchLast],
  );

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const newChat = React.useCallback(() => {
    stop();
    setMessages([]);
    setInput("");
  }, [stop]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sessions sidebar — hidden by default */}
      {showSidebar && (
        <aside className="flex w-60 shrink-0 flex-col border-r border-border/50 bg-muted/20">
          <div className="flex items-center justify-between px-3 py-3">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              Chats
            </span>
            <button
              type="button"
              onClick={newChat}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="New chat"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            <p className="px-2 py-6 text-center text-xs text-muted-foreground/60">
              Your chats are kept to this session for now.
            </p>
          </div>
        </aside>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center gap-2 px-3">
          <button
            type="button"
            onClick={() => setShowSidebar((v) => !v)}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={showSidebar ? "Hide chats" : "Show chats"}
            aria-pressed={showSidebar}
          >
            <PanelLeft className="size-4" />
          </button>
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Sparkles className="size-4 text-violet-500" aria-hidden="true" />
            Assistant
          </span>
          {!isEmpty && (
            <button
              type="button"
              onClick={newChat}
              className="ml-auto rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              New chat
            </button>
          )}
        </header>

        {/* Thread / empty state */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {isEmpty ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-violet-500/12 text-violet-500">
                <Sparkles className="size-6" aria-hidden="true" />
              </div>
              <h1 className="font-hero text-2xl font-semibold tracking-tight text-foreground">
                How can I help?
              </h1>
              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-xl border border-border/60 bg-card/50 px-4 py-3 text-left text-sm text-foreground/80 transition-colors hover:border-border hover:bg-card"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} streaming={streaming} />
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="shrink-0 px-4 pb-5 pt-2">
          <div className="mx-auto max-w-2xl">
            <div className="flex items-end gap-2 rounded-2xl border border-border/60 bg-card/60 p-2 shadow-sm backdrop-blur-sm focus-within:border-border">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="Message the assistant…"
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={stop}
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity hover:opacity-90"
                  aria-label="Stop"
                >
                  <Square className="size-4 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void send(input)}
                  disabled={!input.trim()}
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                  aria-label="Send"
                >
                  <ArrowUp className="size-4" />
                </button>
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground/50">
              Poggle assistant can make mistakes. Check important info.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageRow({ message, streaming }: { message: Message; streaming: boolean }) {
  const isUser = message.role === "user";
  const isPendingAssistant = !isUser && message.content.length === 0;

  return (
    <div className={cn("flex gap-3", isUser && "justify-end")}>
      {!isUser && (
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-500">
          <Sparkles className="size-3.5" aria-hidden="true" />
        </span>
      )}
      <div
        className={cn(
          "min-w-0 whitespace-pre-wrap text-sm leading-relaxed",
          isUser
            ? "max-w-[85%] rounded-2xl bg-violet-600 px-4 py-2.5 text-white"
            : "flex-1 pt-1 text-foreground/90",
        )}
      >
        {isPendingAssistant && streaming ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-current" />
            <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
          </span>
        ) : (
          message.content
        )}
      </div>
    </div>
  );
}
