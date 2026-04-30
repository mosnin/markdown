"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Mic, MicOff } from "lucide-react";
import { quickCaptureAction } from "@/app/capture/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useVoiceCapture } from "@/lib/hooks/use_voice_capture";

function formatRelativeTime(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

interface BoxRef {
  id: string;
  name: string;
  slug: string;
}

interface CaptureEntry {
  id: string;
  title: string;
  boxName: string;
  savedAt: Date;
}

export interface CaptureViewProps {
  workspaceId: string;
  workspaceName: string;
  boxes: BoxRef[];
  initialTitle: string;
  initialBody: string;
  hasShareData: boolean;
}

export function CaptureView(props: CaptureViewProps) {
  const router = useRouter();
  const [title, setTitle] = useState(props.initialTitle);
  const [body, setBody] = useState(props.initialBody);
  const [boxId, setBoxId] = useState<string | null>(
    () =>
      props.boxes.find((b) => /^inbox/i.test(b.name))?.id ??
      props.boxes[0]?.id ??
      null
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentCaptures, setRecentCaptures] = useState<CaptureEntry[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Focus body on mount (mobile keyboard + ready to type immediately)
  useEffect(() => {
    bodyRef.current?.focus();
  }, []);

  async function save() {
    const trimmed = body.trim();
    const trimmedTitle = title.trim();
    if (!trimmed && !trimmedTitle) return;
    setPending(true);
    setError(null);
    try {
      const result = await quickCaptureAction({
        title:
          trimmedTitle ||
          trimmed.split("\n")[0].slice(0, 80) ||
          "Untitled capture",
        markdown: trimmed,
        boxId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecentCaptures((prev) =>
        [
          {
            id: result.data.noteId,
            title:
              trimmedTitle ||
              trimmed.split("\n")[0].slice(0, 60) ||
              "Untitled",
            boxName: result.data.boxName,
            savedAt: new Date(),
          },
          ...prev,
        ].slice(0, 10)
      );
      // Clear for the next capture
      setTitle("");
      setBody("");
      bodyRef.current?.focus();
      // If a new box was auto-created, refresh the list so the picker reflects it
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  function onBodyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter saves; bare Enter inserts newline (textarea default)
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void save();
    }
  }

  const { state: voiceState, toggle: toggleVoice } = useVoiceCapture((transcript) => {
    setBody((prev) => (prev ? `${prev} ${transcript}` : transcript));
  });

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header — sticky top, edge-to-edge on notched devices */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link
          href="/app"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Done
        </Link>
        <span className="text-sm font-medium text-foreground">Capture</span>
        <div className="flex items-center gap-2">
          {voiceState !== "unsupported" && (
            <Button
              type="button"
              size="icon-sm"
              variant={voiceState === "listening" ? "destructive" : "outline"}
              onClick={toggleVoice}
              title={voiceState === "listening" ? "Stop recording" : "Voice input"}
            >
              {voiceState === "listening" ? (
                <MicOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Mic className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )}
          <Button
            size="sm"
            onClick={save}
            disabled={pending || (!title.trim() && !body.trim())}
          >
            {pending ? (
              <Spinner size={14} />
            ) : (
              <Check className="h-4 w-4" aria-hidden="true" />
            )}
            {pending ? "Saving" : "Save"}
          </Button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Body — fills the rest of the screen */}
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div>
          <label
            htmlFor="capture-title"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Title
          </label>
          <Input
            id="capture-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional"
            maxLength={200}
          />
        </div>

        <div className="flex flex-1 flex-col">
          <label
            htmlFor="capture-body"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Note
          </label>
          <textarea
            id="capture-body"
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onBodyKeyDown}
            placeholder={
              props.hasShareData
                ? "Add a note to the shared content…"
                : "What's on your mind? Markdown welcome."
            }
            className={cn(
              "flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground",
              "placeholder:text-foreground/40",
              "transition-[border-color,box-shadow,background-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
              "outline-none focus-visible:border-brand/60 focus-visible:ring-2 focus-visible:ring-ring/40",
              "dark:bg-card/60"
            )}
          />
        </div>

        {/* Box picker — minimal native select for v1 */}
        <div>
          <label
            htmlFor="capture-box"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Save to
          </label>
          <div className="relative">
            <select
              id="capture-box"
              value={boxId ?? "__create__"}
              onChange={(e) =>
                setBoxId(e.target.value === "__create__" ? null : e.target.value)
              }
              className={cn(
                "h-9 w-full appearance-none rounded-md border border-input bg-card px-3 pr-8 text-sm text-foreground",
                "outline-none transition-[border-color,box-shadow,background-color] duration-150",
                "focus-visible:border-brand/60 focus-visible:ring-2 focus-visible:ring-ring/40",
                "dark:bg-card/60"
              )}
            >
              {props.boxes.length === 0 && (
                <option value="__create__">Inbox (auto-create)</option>
              )}
              {props.boxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              {props.boxes.length > 0 && (
                <option value="__create__">+ Create new Inbox</option>
              )}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {body.length} chars · ⌘↵ to save
        </p>

        {recentCaptures.length > 0 && (
          <div className="mt-2 border-t border-border pt-4">
            <p className="mb-2 text-overline text-muted-foreground/70">
              Saved this session
            </p>
            <ul className="space-y-1">
              {recentCaptures.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      {entry.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.boxName}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground/60">
                    {formatRelativeTime(entry.savedAt)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <Button render={<a href="/app" />}>
                View in workspace
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
