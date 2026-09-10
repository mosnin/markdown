import { cn } from "@/lib/utils";

/**
 * An incoming agent asking the relay what happened before it: the agent
 * member decides, the agent branches the work for review. Adapted from
 * ForgeUI "Chat Thread"; the bubble shapes and the 1.3s blink are the
 * original's. The agent's turn is tinted with the agent wash, which is the
 * one hue that means "an agent did this".
 */
const BUBBLE =
  "w-fit max-w-full rounded-16 rounded-bl-4 border border-border bg-raised px-6 py-5 shadow-elev-1";

export function ChatThread({
  className,
  variant = "proposal",
}: {
  className?: string;
  variant?: "proposal" | "knowledge";
}) {
  const knowledge = variant === "knowledge";
  return (
    <div className={cn("flex w-full flex-col gap-8 px-9 py-9", className)}>
      <style>{`
        @keyframes ct-blink {
          0%, 70%, 100% { opacity: .35; transform: translateY(0); }
          35% { opacity: 1; transform: translateY(-3px); }
        }
        .ct-dot { animation: ct-blink 1.3s ease-in-out infinite; }
      `}</style>

      <div className="w-full max-w-[320px]">
        <div className="mb-4 flex items-baseline gap-4">
          <span
            className={cn(
              "t-mk-ill-13s",
              knowledge ? "text-ink" : "text-agent-text",
            )}
          >
            {knowledge ? "Fresh agent" : "Claude Code"}
          </span>
          <span className="t-mk-ill-12 text-ink-3">09:41</span>
        </div>
        <div className={BUBBLE}>
          <p className="t-mk-ill-13 text-ink">
            {knowledge
              ? "What was the last agent doing?"
              : "Anything I should know before I start?"}
          </p>
        </div>
      </div>

      <div className="w-full max-w-[320px]">
        <div className="mb-4 flex items-baseline gap-4">
          <span
            className={cn(
              "t-mk-ill-13s",
              knowledge ? "text-agent-text" : "text-ink",
            )}
          >
            {knowledge ? "Handoff brief" : "Poggle"}
          </span>
          <span className="t-mk-ill-12 text-ink-3">09:43</span>
        </div>
        <div className={BUBBLE}>
          <p className="t-mk-ill-13 text-ink">
            {knowledge
              ? "Capped mid-migration. The retry middleware is rewritten but untested, and the Redis approach was already ruled out."
              : "Three sessions before you. Two decisions, one blocker."}
          </p>
        </div>
      </div>

      <div className="w-full max-w-[320px]">
        <div className="mb-4 flex items-baseline gap-4">
          <span className="t-mk-ill-13s text-agent-text">
            {knowledge ? "3 sessions · 1,840 tokens" : "Claude Code"}
          </span>
          <span className="t-mk-ill-12 text-ink-3">09:43</span>
        </div>
        <div className="w-fit rounded-16 rounded-bl-4 border border-agent-border bg-agent-wash px-6 py-4">
          <div className="flex items-center gap-4">
            <span className="t-mk-ill-13 text-agent-text">
              {knowledge
                ? "session 4c1f · usage_capped"
                : "Reading the brief"}
            </span>
            {!knowledge && (
              <div className="flex gap-2">
                {[0, 160, 320].map((delay) => (
                  <span
                    key={delay}
                    data-mk-motion=""
                    className="ct-dot size-[6px] rounded-full bg-agent"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
