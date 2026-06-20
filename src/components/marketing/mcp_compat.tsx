/* eslint-disable @next/next/no-img-element -- vendored brand SVGs render as plain <img>; next/image adds no value for static same-origin SVGs */
import { Reveal } from "@/components/marketing/reveal";

// ─── MCP compatibility band ──────────────────────────────────────────────────
//
// Honest social proof: Poggle exposes a standard MCP server, so it works with
// any MCP client. These are real models and agents that speak the protocol —
// no implied partnerships. Their brand SVGs are vendored locally in
// /public/logos (CSP-safe, no runtime hotlinking) and scroll in an infinite,
// hover-pausable, reduced-motion-aware marquee. They sit on white tiles because
// the theme is system (light *and* dark) and these logos hardcode their own
// colors — including pure black/white — so a neutral tile keeps every one legible
// on either theme without recolouring the brands.

type Logo = { slug: string; name: string };

const LOGOS: Logo[] = [
  { slug: "claude", name: "Claude" },
  { slug: "openai", name: "ChatGPT" },
  { slug: "cursor", name: "Cursor" },
  { slug: "github-copilot", name: "Copilot" },
  { slug: "windsurf", name: "Windsurf" },
  { slug: "gemini", name: "Gemini" },
  { slug: "cline", name: "Cline" },
  { slug: "kimi", name: "Kimi" },
  { slug: "grok", name: "Grok" },
  { slug: "deepseek", name: "DeepSeek" },
  { slug: "qwen", name: "Qwen" },
  { slug: "manus", name: "Manus" },
  { slug: "hermesagent", name: "Hermes" },
  { slug: "opencode", name: "OpenCode" },
  { slug: "kilocode", name: "Kilo Code" },
  { slug: "vscode", name: "VS Code" },
];

export function McpCompat() {
  return (
    <section className="border-b border-border/30 px-6 py-14">
      <Reveal className="mx-auto flex max-w-5xl flex-col items-center gap-8 text-center">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Compatible with
        </p>

        <LogoMarquee />

        <p className="max-w-md text-sm text-muted-foreground/70">
          Poggle exposes a standard MCP server — if your agent speaks MCP, it
          connects. No SDK, no lock-in.
        </p>
      </Reveal>
    </section>
  );
}

function LogoMarquee() {
  // Two identical copies make the -50% keyframe loop seamlessly.
  const copies = [0, 1] as const;

  return (
    <div className="relative w-full overflow-hidden py-1 [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)]">
      <ul className="group flex w-max list-none items-center animate-[logo-marquee_34s_linear_infinite] hover:[animation-play-state:paused] motion-reduce:animate-none">
        {copies.map((copy) =>
          LOGOS.map((logo) => (
            <li
              key={`${copy}-${logo.slug}`}
              aria-hidden={copy === 1 ? true : undefined}
              className="mr-4 flex h-14 shrink-0 items-center gap-3 rounded-2xl bg-white px-5 shadow-sm ring-1 ring-black/5 transition-transform duration-200 hover:-translate-y-0.5"
            >
              <img
                src={`/logos/${logo.slug}.svg`}
                alt={copy === 0 ? logo.name : ""}
                className="h-7 w-7 shrink-0 object-contain"
                loading="lazy"
                draggable={false}
              />
              <span className="whitespace-nowrap text-sm font-medium text-neutral-700">
                {logo.name}
              </span>
            </li>
          )),
        )}
      </ul>
    </div>
  );
}
