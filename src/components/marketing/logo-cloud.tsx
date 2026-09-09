import Link from "next/link";
import { SiClaude, SiCursor, SiGit, SiGnubash } from "react-icons/si";

/**
 * The runtimes Poggle captures from.
 *
 * Compatibility identifiers, not endorsements. Listed because the first
 * question anyone asks is "does it work with what I already run", and the
 * honest answer is that the hook shim is the integration — anything that can
 * execute a command on a lifecycle event is supported, which is why a plain
 * shell entry sits alongside the named tools rather than being hidden behind
 * an "and more".
 */
const RUNTIMES = [
  { name: "Claude Code", Icon: SiClaude },
  { name: "Codex CLI", Icon: SiGnubash },
  { name: "Cursor", Icon: SiCursor },
  { name: "Git hooks", Icon: SiGit },
] as const;

export function LogoCloud() {
  return (
    <div className="flex flex-col gap-6 border-y border-hairline py-8 sm:flex-row sm:items-center sm:justify-between">
      <p className="t-body max-w-[36ch] text-ink-2">
        Every agent writes to the same log, whichever tool it runs in.
      </p>
      <ul className="flex flex-wrap items-center gap-x-8 gap-y-6">
        {RUNTIMES.map(({ name, Icon }) => (
          <li key={name}>
            <Link
              href="/how-it-works"
              className="focus-ring-canvas flex items-center gap-3 rounded-4 px-2 py-2 text-ink hover:bg-state-hover"
            >
              <Icon size={24} aria-hidden="true" />
              <span className="t-body-strong">{name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
