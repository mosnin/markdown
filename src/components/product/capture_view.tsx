"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown } from "lucide-react";
import { quickCaptureAction } from "@/app/capture/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface BoxRef {
  id: string;
  name: string;
  slug: string;
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
  const [savedToast, setSavedToast] = useState<string | null>(null);
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
      setSavedToast(`Saved to ${result.data.boxName}`);
      // Clear for the next capture
      setTitle("");
      setBody("");
      bodyRef.current?.focus();
      // Hide the toast after 2.5s
      setTimeout(() => setSavedToast(null), 2500);
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

      {savedToast && (
        <div className="border-b border-border bg-green-500/10 px-4 py-2 text-center text-sm text-green-700 dark:text-green-400">
          {savedToast}
        </div>
      )}

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
      </div>
    </div>
  );
}
