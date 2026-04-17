"use client";

import { cn } from "@/lib/utils";
import type { PresentUser } from "@/lib/hooks/use_branch_presence";

/**
 * Renders up to `max` colored initial avatars for users currently
 * present on a branch, with a `+N` pill for any overflow. Each avatar
 * carries a native `title` tooltip that spells out the full display
 * name so a hover reveals who the initial belongs to.
 *
 * Deterministic color picking: the hash of the display name maps to
 * one of six muted fills, so the same user always renders in the
 * same color across sessions and surfaces.
 */
export function BranchPresenceAvatars({
  users,
  max = 3,
}: {
  users: PresentUser[];
  max?: number;
}) {
  if (users.length === 0) return null;
  const shown = users.slice(0, max);
  const overflow = users.length - shown.length;
  // Compose a summary title on the wrapper so screen readers and
  // hover tooltips get a human-friendly roster even when avatars are
  // collapsed.
  const summary =
    users.length === 1
      ? `${users[0].display_name} is viewing this branch right now`
      : `${users.map((u) => u.display_name).join(", ")} are viewing this branch right now`;
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

function Avatar({ user }: { user: PresentUser }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-full border border-background text-[10px] font-semibold text-white",
        hashColor(user.user_id)
      )}
      title={`${user.display_name} is viewing this branch right now`}
      aria-label={user.display_name}
    >
      {initialOf(user.display_name)}
    </span>
  );
}
