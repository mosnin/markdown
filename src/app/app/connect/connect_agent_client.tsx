"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Client-side interactivity for the Connect-agent page: copy-to-clipboard for
 * the MCP endpoint URL and the client config snippets. Pure presentation — the
 * canonical MCP URL is resolved server-side and passed in as a prop.
 */

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard API unavailable (e.g. non-secure context); no-op.
        }
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-fast",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        copied ? "text-foreground" : "text-foreground/70"
      )}
      aria-label={copied ? "Copied to clipboard" : label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

function ConfigBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="text-xs font-medium text-foreground/70">{title}</span>
        <CopyButton value={code} label="Copy" />
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-xs leading-relaxed text-foreground/80">
        {code}
      </pre>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground"
        aria-hidden="true"
      >
        {n}
      </span>
      <span className="text-sm text-foreground/80">{children}</span>
    </li>
  );
}

export function ConnectAgentClient({ mcpUrl }: { mcpUrl: string }) {
  // Native remote-URL config (Claude Desktop, Cursor, and other clients that
  // speak remote MCP directly). Key name is the server label the user will see.
  const nativeConfig = JSON.stringify(
    { mcpServers: { poggle: { url: mcpUrl } } },
    null,
    2
  );
  // Fallback for clients without native remote-MCP support: the widely-used
  // `mcp-remote` shim bridges a stdio client to an OAuth HTTP MCP server.
  const remoteConfig = JSON.stringify(
    { mcpServers: { poggle: { command: "npx", args: ["mcp-remote", mcpUrl] } } },
    null,
    2
  );

  return (
    <div className="space-y-8">
      {/* MCP endpoint */}
      <section className="space-y-2">
        <h2 className="text-overline">Your MCP endpoint</h2>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5">
          <code className="flex-1 truncate font-mono text-sm text-foreground">
            {mcpUrl}
          </code>
          <CopyButton value={mcpUrl} label="Copy URL" />
        </div>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            This endpoint is public — there are no secrets to paste. Access is
            granted per-user through a one-time OAuth consent and your workspace
            role (viewers are clamped to read-only).
          </span>
        </p>
      </section>

      {/* How to connect */}
      <section className="space-y-3">
        <h2 className="text-overline">How to connect</h2>
        <ol className="space-y-2.5">
          <Step n={1}>
            Add the MCP endpoint above to your agent or MCP client (see the
            config snippets below).
          </Step>
          <Step n={2}>
            Approve the one-time OAuth consent screen. You choose what the agent
            can do; reads are granted by default, writes always go through review.
          </Step>
          <Step n={3}>
            Your agent reads workspace context and submits proposals — approve or
            reject them in{" "}
            <Link
              href="/app/proposals"
              className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              AI Edits
            </Link>
            .
          </Step>
        </ol>
      </section>

      {/* Client configuration */}
      <section className="space-y-3">
        <h2 className="text-overline">Client configuration</h2>
        <p className="text-sm text-muted-foreground">
          Most clients support remote MCP servers directly. If yours only speaks
          stdio, use the <code className="font-mono text-xs">mcp-remote</code>{" "}
          fallback — both complete the same OAuth flow.
        </p>
        <ConfigBlock title="Remote URL — Claude Desktop, Cursor, …" code={nativeConfig} />
        <ConfigBlock title="Fallback — stdio clients via mcp-remote" code={remoteConfig} />
      </section>

      {/* Manage */}
      <section className="space-y-3">
        <h2 className="text-overline">Manage access</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link
            href="/app/settings/oauth_clients"
            className="group flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 transition-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-sm text-foreground/80">Developer apps</span>
            <ExternalLink
              className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground"
              aria-hidden="true"
            />
          </Link>
          <Link
            href="/app/settings/connected_apps"
            className="group flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 transition-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-sm text-foreground/80">Connected apps</span>
            <ExternalLink
              className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground"
              aria-hidden="true"
            />
          </Link>
        </div>
      </section>
    </div>
  );
}
