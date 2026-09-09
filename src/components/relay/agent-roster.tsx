import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { PeerAgent } from "@/server/services/coordination_service";

/* ==========================================================================
   Who is working, right now.

   Status is a fill, not a badge colour on text: positive for active, neutral
   for idle. `current_intent` is the row's whole point — a roster that only
   said "Claude Code, active" would tell you nothing you could act on, whereas
   "rewriting the retry middleware" tells you where not to go.
   ========================================================================== */

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function AgentRoster({ agents }: { agents: PeerAgent[] }): ReactNode {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="t-label-caps text-ink-3">Agents</h2>

      {agents.length === 0 ? (
        <div className="rounded-12 border border-dashed border-hairline px-6 py-8 text-center">
          <p className="t-caption text-ink-3">
            Nobody is working on this project right now.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <li
              key={agent.session_id}
              className="flex flex-col gap-3 rounded-12 border border-hairline bg-raised p-5"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "size-[7px] shrink-0 rounded-full",
                    agent.status === "active"
                      ? "bg-positive-mark"
                      : "bg-neutral-mark",
                  )}
                />
                <span className="t-body-medium min-w-0 flex-1 truncate text-ink">
                  {agent.agent_tool}
                </span>
                {agent.account_label ? (
                  <span className="t-mono-micro shrink-0 text-ink-4">
                    {agent.account_label}
                  </span>
                ) : null}
              </div>

              <p className="t-caption min-h-[2.5em] text-ink-2">
                {agent.current_intent ?? (
                  <span className="text-ink-4">no stated intent</span>
                )}
              </p>

              {agent.claims.length > 0 ? (
                <div className="flex flex-col gap-1 border-t border-hairline pt-3">
                  <span className="t-label-caps text-ink-3">Holding</span>
                  {agent.claims.slice(0, 3).map((claim) => (
                    <span
                      key={claim}
                      className="t-mono-micro truncate text-ink-2"
                    >
                      {claim}
                    </span>
                  ))}
                  {agent.claims.length > 3 ? (
                    <span className="t-caption text-ink-4">
                      +{agent.claims.length - 3} more
                    </span>
                  ) : null}
                </div>
              ) : null}

              <p className="t-caption text-ink-4">
                {agent.git_branch ? `${agent.git_branch} · ` : ""}
                seen {relative(agent.last_seen_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
