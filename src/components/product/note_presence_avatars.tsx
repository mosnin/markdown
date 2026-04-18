"use client";

import { cn } from "@/lib/utils";
import type { NotePresentUser } from "@/lib/hooks/use_note_presence";

/**
 * Renders up to `max` colored initial avatars for users currently
 * editing a note, with a `+N` pill for any overflow. Mirrors the
 * BranchPresenceAvatars component style with identical color picking
 * and layout.
 */
export function NotePresenceAvatars({
  users,
  max = 3,
}: {
  users: NotePresentUser[];
  max?: number;
}) {
  if (users.length === 0) return null;
  const shown = users.slice(0, max);
  const overflow = users.length - shown.length;
  const summary =
    users.length === 1
      ? `${users[0].display_name} is editing this note right now`
      : `${users.map((u) => u.display_name).join(", ")} are editing this note right now`;
  return (
    <div
      className="flex items-center -space-x-1.5"
      title={summary}
      aria-label={summary}
    >
      {shown.map((u) => (
        <Avatar key={u.user_id} user={u} />
      ))}
      {overflow > 0 && (
        <span
          className="z-10 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full border border-background bg-muted px-1.5 text-[10px] font-medium text-muted-foreground"
          title={users
            .slice(max)
            .map((u) => u.display_name)
            .join(", ")}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

const COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
];

function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return COLORS[h % COLORS.length];
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed[0].toUpperCase();
}

function Avatar({ user }: { user: NotePresentUser }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-full border border-background text-[10px] font-semibold text-white",
        hashColor(user.user_id)
      )}
      title={`${user.display_name} is editing this note right now`}
      aria-label={user.display_name}
    >
      {initialOf(user.display_name)}
    </span>
  );
}
