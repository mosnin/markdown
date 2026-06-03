import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { getCanonicalBaseUrl } from "@/lib/canonical_url";
import { ConnectAgentClient } from "./connect_agent_client";

/**
 * Connect an AI agent to this workspace over MCP.
 *
 * The activation surface for the core loop: an MCP-compatible client points at
 * the MCP endpoint, authenticates via OAuth 2.1 + PKCE (auto-discovered from the
 * `/.well-known/*` documents — no hand configuration), reads workspace context,
 * and submits write *proposals* a human approves in AI Edits. Nothing here is
 * secret: the MCP URL is public and access is gated by per-user OAuth consent
 * and workspace role. Client copy-to-clipboard interactivity lives in
 * `connect_agent_client.tsx`; the URL itself is resolved server-side so it is
 * correct on every deployment (canonical / preview / local).
 */
export default async function ConnectAgentPage() {
  await requireAuthenticatedUser();

  const baseUrl = getCanonicalBaseUrl();
  const mcpUrl = `${baseUrl}/api/mcp`;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-background px-6 pt-6 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Connect an agent
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Point any MCP-compatible AI client at your workspace. It can read your
          context and propose changes — every write is reviewed by you in{" "}
          <Link
            href="/app/proposals"
            className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
          >
            AI Edits
          </Link>{" "}
          before anything is applied.
        </p>
      </div>
      <Separator />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <ConnectAgentClient mcpUrl={mcpUrl} />
        </div>
      </div>
    </div>
  );
}
