import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "@/server/domain/types/agent_session";

/* ==========================================================================
   The session history.

   `end_reason` gets the emphasis, because it is the one column that changes
   what a reader does next: a session that finished is history, and one that
   capped is unfinished work somebody still has to pick up.
   ========================================================================== */

const UNFINISHED = new Set(["usage_capped", "context_exhausted", "crashed"]);

function describeEnding(session: SessionSummary): {
  label: string;
  tone: "positive" | "critical" | "neutral";
} {
  if (session.status !== "ended") {
    return {
      label: session.status === "idle" ? "idle" : "running",
      tone: session.status === "idle" ? "neutral" : "positive",
    };
  }
  if (session.end_reason && UNFINISHED.has(session.end_reason)) {
    return { label: session.end_reason.replace(/_/g, " "), tone: "critical" };
  }
  if (session.end_reason === "completed") {
    return { label: "completed", tone: "neutral" };
  }
  return { label: session.end_reason?.replace(/_/g, " ") ?? "ended", tone: "neutral" };
}

const TONE: Record<"positive" | "critical" | "neutral", string> = {
  positive: "bg-positive-wash text-positive-text",
  critical: "bg-critical-wash text-critical-text",
  neutral: "bg-neutral-wash text-neutral-text",
};

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SessionList({
  sessions,
}: {
  sessions: SessionSummary[];
}): ReactNode {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="t-label-caps text-ink-3">Sessions</h2>

      {sessions.length === 0 ? (
        <div className="rounded-12 border border-dashed border-hairline px-6 py-8 text-center">
          <p className="t-caption text-ink-3">No sessions logged yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-12 border border-hairline bg-raised">
          {sessions.map((session) => {
            const ending = describeEnding(session);
            return (
              <li
                key={session.id}
                className="flex items-center gap-5 px-6 py-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="t-body-medium truncate text-ink">
                      {session.agent_tool}
                    </span>
                    {session.account_label ? (
                      <span className="t-mono-micro shrink-0 text-ink-4">
                        {session.account_label}
                      </span>
                    ) : null}
                  </div>
                  <p className="t-caption mt-1 truncate text-ink-3">
                    {session.title ?? session.goal ?? session.git_branch ?? "—"}
                  </p>
                </div>

                <span
                  className={cn(
                    "t-label-caps hidden shrink-0 rounded-full px-3 py-1 sm:inline-flex",
                    TONE[ending.tone],
                  )}
                >
                  {ending.label}
                </span>

                <div className="hidden w-[110px] shrink-0 text-right md:block">
                  <p className="t-mono-micro text-ink-2">
                    {session.event_count} events
                  </p>
                  <p className="t-caption mt-1 text-ink-4">
                    {relative(session.started_at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
