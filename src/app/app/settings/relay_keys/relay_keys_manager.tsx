"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, RotateCw, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  createRelayKeyAction,
  revokeRelayKeyAction,
  rotateRelayKeyAction,
} from "./actions";
import type { RelayKeySummary } from "@/server/services/relay_key_service";

/**
 * Relay key management surface.
 *
 * The one screen that stands between a fresh install and a working relay. Its
 * job is not really "manage credentials" — it is to get a working key onto a
 * developer's machine with the fewest possible steps, which is why the reveal
 * panel hands over the exact shell command rather than the bare secret.
 *
 * The secret is shown once. There is no code path that can recover it: the
 * database holds a prefix and a sha256. Losing it means rotating, and the UI
 * says so before the moment it matters rather than after.
 */

interface Props {
  initialKeys: RelayKeySummary[];
  apiUrl: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The reveal panel: a secret, and the exact command to install it. */
function RevealedKey({
  token,
  apiUrl,
  onDismiss,
}: {
  token: string;
  apiUrl: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState<"token" | "command" | null>(null);

  const command = [
    "mkdir -p ~/.poggle && cat > ~/.poggle/config.json <<'EOF'",
    JSON.stringify({ token, api_url: apiUrl }, null, 2),
    "EOF",
  ].join("\n");

  async function copy(text: string, which: "token" | "command") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard can be blocked by permissions or a non-secure context. The
      // value is on screen and selectable, so this is a convenience, not a
      // dependency.
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Copy this now — it is shown once
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              We store only a hash. If you lose it, rotate the key to get a new
              one; there is no way to look this up again.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border bg-background px-2 py-1.5 font-mono text-xs">
              {token}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy(token, "token")}
              aria-label="Copy relay key"
            >
              {copied === "token" ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Install it on the machine that runs your agents:
            </p>
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto rounded border bg-background px-2 py-1.5 font-mono text-[11px] leading-relaxed">
                {command}
              </pre>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copy(command, "command")}
                aria-label="Copy install command"
              >
                {copied === "command" ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Then run{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                poggle init
              </code>{" "}
              inside a repo to install the hooks.
            </p>
          </div>

          <Button size="sm" variant="ghost" onClick={onDismiss}>
            I&apos;ve saved it
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RelayKeysManager({ initialKeys, apiUrl }: Props) {
  const [keys, setKeys] = useState<RelayKeySummary[]>(initialKeys);
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    if (!name.trim()) {
      setError("Give the key a name — you will want to know which machine it is on.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await createRelayKeyAction({ name: name.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRevealed(result.data.token);
      setKeys((current) => [result.data.key, ...current]);
      setName("");
    });
  }

  function handleRotate(connectionId: string) {
    setError(null);
    startTransition(async () => {
      const result = await rotateRelayKeyAction(connectionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRevealed(result.data.token);
      setKeys((current) =>
        current.map((k) =>
          k.connection_id === connectionId
            ? { ...k, token_prefix: result.data.token_prefix, last_used_at: null }
            : k
        )
      );
    });
  }

  function handleRevoke(connectionId: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeRelayKeyAction(connectionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setKeys((current) => current.filter((k) => k.connection_id !== connectionId));
    });
  }

  return (
    <div className="space-y-5">
      {revealed && (
        <RevealedKey
          token={revealed}
          apiUrl={apiUrl}
          onDismiss={() => setRevealed(null)}
        />
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-medium text-foreground">New relay key</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          One per machine is the usual shape — name it after the laptop or the CI
          runner it will live on.
        </p>
        <div className="mt-3 flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="e.g. work-laptop, ci-runner"
            disabled={pending}
            className="max-w-sm"
          />
          <Button onClick={handleCreate} disabled={pending}>
            <KeyRound className="mr-1.5 size-3.5" />
            Create key
          </Button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-foreground">
          Active keys{keys.length > 0 && ` (${keys.length})`}
        </h3>

        {keys.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No relay keys yet. Agents cannot log anything until one exists.
            </p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {keys.map((key) => (
              <li
                key={key.connection_id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {key.name}
                    </span>
                    {key.token_prefix && (
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        pgr_v1_{key.token_prefix}…
                      </code>
                    )}
                    {/* A key that has never been used usually means the config
                        never landed on the machine — worth surfacing, since the
                        failure is otherwise silent. */}
                    {!key.last_used_at && (
                      <Badge variant="outline" className="text-[10px]">
                        never used
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Created {relativeTime(key.created_at)} · Last used{" "}
                    {relativeTime(key.last_used_at)}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => handleRotate(key.connection_id)}
                  title="Replace the secret, keep the key"
                >
                  <RotateCw className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => handleRevoke(key.connection_id)}
                  title="Revoke permanently"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
