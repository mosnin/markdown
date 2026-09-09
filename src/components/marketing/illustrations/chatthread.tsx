import { cn } from "@/lib/utils";

/**
 * An agent and a member inside the ledger's rules: the agent proposes, the
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
            {knowledge ? "Dana" : "Marketing agent"}
          </span>
          <span className="t-mk-ill-12 text-ink-3">09:41</span>
        </div>
        <div className={BUBBLE}>
          <p className="t-mk-ill-13 text-ink">
            {knowledge
              ? "Who is our product for?"
              : "Draft an ICP update from the Q3 interviews?"}
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
            {knowledge ? "Company Brain" : "Dana"}
          </span>
          <span className="t-mk-ill-12 text-ink-3">09:43</span>
        </div>
        <div className={BUBBLE}>
          <p className="t-mk-ill-13 text-ink">
            {knowledge
              ? "Operations leads at growing B2B companies. The customer profile describes their handoff problems and buying triggers."
              : "Yes, branch it for review"}
          </p>
        </div>
      </div>

      <div className="w-full max-w-[320px]">
        <div className="mb-4 flex items-baseline gap-4">
          <span className="t-mk-ill-13s text-agent-text">
            {knowledge ? "Company knowledge" : "Marketing agent"}
          </span>
          <span className="t-mk-ill-12 text-ink-3">09:43</span>
        </div>
        <div className="w-fit rounded-16 rounded-bl-4 border border-agent-border bg-agent-wash px-6 py-4">
          <div className="flex items-center gap-4">
            <span className="t-mk-ill-13 text-agent-text">
              {knowledge
                ? "Customer profile · Source"
                : "Working on the proposal"}
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
