"use client";

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  CircleDot,
  MessageSquare,
  Reply,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  createNoteCommentAction,
  resolveNoteCommentAction,
  unresolveNoteCommentAction,
  deleteNoteCommentAction,
} from "@/app/app/notes/[note_id]/comment_actions";
import type {
  NoteComment,
  ThreadedComment,
} from "@/server/services/note_comment_service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Render body with @mention highlights (display only, no notification). */
function renderBody(body: string) {
  const parts = body.split(/(@[\w.+\-]+@[\w.\-]+)/g);
  let offset = 0;
  return parts.map((part) => {
    const key = `${part.startsWith("@") ? "m" : "t"}-${part.slice(0, 20)}-${offset}`;
    offset += part.length;
    return part.startsWith("@") ? (
      <span
        key={key}
        className="rounded bg-blue-100 px-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
      >
        {part}
      </span>
    ) : (
      <span key={key}>{part}</span>
    );
  });
}

function shortAuthor(authorId: string): string {
  return authorId.slice(0, 8) + "\u2026";
}

// ─── Single comment row ───────────────────────────────────────────────────────

function CommentRow({
  comment,
  noteId,
  currentUserId,
  isReply,
}: {
  comment: NoteComment;
  noteId: string;
  currentUserId: string;
  isReply?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div
      className={cn(
        "group relative px-4 py-2.5",
        isReply && "ml-6 border-l-2 border-border pl-4",
        comment.resolved && "opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="font-medium text-foreground/70">
              {shortAuthor(comment.author_id)}
            </span>
            <span>{formatDate(comment.created_at)}</span>
            {comment.resolved && (
              <span className="flex items-center gap-0.5 text-green-600 dark:text-green-500">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Resolved
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap">
            {renderBody(comment.body)}
          </p>
        </div>

        {/* Actions — visible on hover */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!isReply && (
            <Button
              variant="ghost"
              size="icon-xs"
              title={comment.resolved ? "Unresolve" : "Resolve"}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  if (comment.resolved) {
                    await unresolveNoteCommentAction(noteId, comment.id);
                  } else {
                    await resolveNoteCommentAction(noteId, comment.id);
                  }
                })
              }
            >
              {comment.resolved ? (
                <CircleDot className="h-3 w-3" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
            </Button>
          )}
          {comment.author_id === currentUserId && (
            <Button
              variant="ghost"
              size="icon-xs"
              title="Delete"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteNoteCommentAction(noteId, comment.id);
                })
              }
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Reply form ───────────────────────────────────────────────────────────────

function ReplyForm({
  noteId,
  parentCommentId,
  onClose,
}: {
  noteId: string;
  parentCommentId: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="ml-6 border-l-2 border-border px-4 py-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a reply..."
        className="min-h-[60px] text-xs"
        disabled={pending}
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button
          size="xs"
          disabled={pending || !body.trim()}
          onClick={() =>
            startTransition(async () => {
              const result = await createNoteCommentAction(
                noteId,
                body,
                parentCommentId
              );
              if (result.success) {
                setBody("");
                onClose();
              }
            })
          }
        >
          Reply
        </Button>
        <Button variant="ghost" size="xs" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Thread ───────────────────────────────────────────────────────────────────

function Thread({
  thread,
  noteId,
  currentUserId,
}: {
  thread: ThreadedComment;
  noteId: string;
  currentUserId: string;
}) {
  const [showReply, setShowReply] = useState(false);

  return (
    <div className="border-b border-border last:border-b-0">
      <CommentRow
        comment={thread}
        noteId={noteId}
        currentUserId={currentUserId}
      />
      {thread.replies.map((reply) => (
        <CommentRow
          key={reply.id}
          comment={reply}
          noteId={noteId}
          currentUserId={currentUserId}
          isReply
        />
      ))}
      {showReply ? (
        <ReplyForm
          noteId={noteId}
          parentCommentId={thread.id}
          onClose={() => setShowReply(false)}
        />
      ) : (
        <div className="px-4 pb-2">
          <button
            type="button"
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-fast"
            onClick={() => setShowReply(true)}
          >
            <Reply className="h-3 w-3" />
            Reply
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function NoteCommentsPanel({
  noteId,
  threads,
  currentUserId,
}: {
  noteId: string;
  threads: ThreadedComment[];
  currentUserId: string;
}) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ScrollArea className="flex-1">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-muted-foreground">
            <MessageSquare className="h-8 w-8 opacity-30" />
            <p className="text-xs">No comments yet.</p>
            <p className="text-[10px]">
              Start a discussion on this note.
            </p>
          </div>
        ) : (
          threads.map((thread) => (
            <Thread
              key={thread.id}
              thread={thread}
              noteId={noteId}
              currentUserId={currentUserId}
            />
          ))
        )}
      </ScrollArea>

      {/* Add comment form */}
      <div className="border-t border-border px-4 py-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment... (use @email to mention)"
          className="min-h-[60px] text-xs"
          disabled={pending}
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="xs"
            disabled={pending || !body.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await createNoteCommentAction(noteId, body);
                if (result.success) {
                  setBody("");
                }
              })
            }
          >
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
