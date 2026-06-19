import { Reveal } from "@/components/marketing/reveal";

// ─── MCP compatibility band ──────────────────────────────────────────────────
//
// Honest social proof: Poggle exposes a standard MCP server, so it works with
// any MCP client. These are real clients that speak the protocol — no implied
// partnerships, no borrowed logos. A quiet band right under the hero that says
// "this fits the stack you already have."

const MCP_CLIENTS = [
  "Claude",
  "Claude Code",
  "Cursor",
  "Windsurf",
  "Cline",
  "Zed",
  "Copilot",
  "Continue",
] as const;

export function McpCompat() {
  return (
    <section className="border-b border-border/30 px-6 py-12">
      <Reveal className="mx-auto flex max-w-5xl flex-col items-center gap-6 text-center">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Works with the agents you already use
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {MCP_CLIENTS.map((client) => (
            <span
              key={client}
              className="rounded-full border border-border/60 bg-card/50 px-4 py-1.5 text-sm font-medium text-foreground/75 backdrop-blur-sm transition-colors hover:border-border hover:text-foreground"
            >
              {client}
            </span>
          ))}
        </div>
        <p className="max-w-md text-sm text-muted-foreground/70">
          Poggle exposes a standard MCP server — if your agent speaks MCP, it
          connects. No SDK, no lock-in.
        </p>
      </Reveal>
    </section>
  );
}
