"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown } from "lucide-react";
import { quickCaptureAction } from "@/app/capture/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

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

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header — sticky top, edge-to-edge on notched devices */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link
          href="/app"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Done
        </Link>
        <span className="text-sm font-medium">Capture</span>
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
      </header>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Body — fills the rest of the screen */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="rounded-md border border-border bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          maxLength={200}
        />

        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onBodyKeyDown}
          placeholder={
            props.hasShareData
              ? "Add a note to the shared content…"
              : "What's on your mind? Markdown welcome."
          }
          className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />

        {/* Box picker — minimal native select for v1 */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Save to</span>
          <div className="relative">
            <select
              value={boxId ?? "__create__"}
              onChange={(e) =>
                setBoxId(e.target.value === "__create__" ? null : e.target.value)
              }
              className={cn(
                "appearance-none rounded-md border border-border bg-background px-3 py-1.5 pr-8 text-sm text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring"
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
              className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </div>

        <p className="text-center text-[10px] text-muted-foreground">
          {body.length} chars · ⌘↵ to save
        </p>

        {recentCaptures.length > 0 && (
          <div className="border-t border-border pt-4 mt-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60 mb-2">
              Saved this session
            </p>
            <ul className="space-y-1.5">
              {recentCaptures.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      {entry.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.boxName}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground/50">
                    {formatRelativeTime(entry.savedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
