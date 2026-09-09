import Link from "next/link";
import { SiClaude, SiCursor, SiModelcontextprotocol } from "react-icons/si";

/** Compatibility identifiers, not customer endorsements. App connections are
 * shown separately with their catalog status and supplied provider artwork. */
export function LogoCloud() {
  return (
    <div className="flex flex-col gap-6 border-y border-hairline py-8 sm:flex-row sm:items-center sm:justify-between">
      <p className="t-body max-w-[36ch] text-ink-2">
        Let your AI tools read the company context your team maintains.
      </p>
      <ul className="flex flex-wrap items-center gap-x-8 gap-y-6">
        {[
          { name: "Claude", Icon: SiClaude },
          { name: "Cursor", Icon: SiCursor },
          { name: "MCP clients", Icon: SiModelcontextprotocol },
        ].map(({ name, Icon }) => (
          <li key={name}>
            <Link
              href="/agents"
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
