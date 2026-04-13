"use client";

import { useEffect, useState, useTransition } from "react";
import { Copy, Plus, RefreshCcw, ShieldCheck, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listDeveloperAppsAction,
  registerDeveloperAppAction,
  deleteDeveloperAppAction,
  rotateDeveloperAppSecretAction,
  type DeveloperAppRow,
  type NewlyRegisteredApp,
} from "./developer_apps_actions";
import { ALL_SCOPES, type OAuthScope, OAUTH_SCOPES } from "@/server/services/oauth_scope_service";

/**
 * Developer Apps panel.
 *
 * Register + manage OAuth clients for third-party connectors. The
 * corresponding endpoint at /api/oauth/register is RFC 7591-compliant
 * for scripted registration; this UI is the ergonomic path for humans.
 *
 * Secrets (for confidential clients) are shown once, inline, with a
 * copy button. After the dialog closes they are unrecoverable — the
 * copy in this UI mirrors how the existing connection-token rotation
 * flow behaves.
 */

const AUTH_METHODS = [
  { value: "public", label: "Public (PKCE, no secret)" },
  { value: "confidential", label: "Confidential (server-to-server, with secret)" },
] as const;

export function DeveloperAppsSection() {
  const [rows, setRows] = useState<DeveloperAppRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<NewlyRegisteredApp | null>(null);
  const [loading, startLoad] = useTransition();

  const refresh = () => {
    startLoad(async () => {
      const res = await listDeveloperAppsAction();
      if (res.ok) {
        setRows(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <Card id="settings-developer-apps">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Developer apps</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          OAuth clients you have registered for third-party MCP
          connectors. Public clients use PKCE and never hold a secret;
          confidential clients can present a client_secret for
          server-to-server calls.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-4">
        {error && (
          <p className="text-sm text-destructive" role="alert">{error}</p>
        )}
        <div className="flex justify-between items-center">
          <p className="text-xs text-muted-foreground">
            {rows ? `${rows.length} app${rows.length === 1 ? "" : "s"} registered` : loading ? "Loading…" : "—"}
          </p>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            Register app
          </Button>
        </div>

        {rows && rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            No registered apps yet. Click &ldquo;Register app&rdquo; to create
            an OAuth client for a third-party connector, or use the RFC
            7591 endpoint at{" "}
            <code className="text-xs">/api/oauth/register</code>.
          </div>
        ) : rows ? (
          <ul className="flex flex-col gap-2 list-none">
            {rows.map((r) => (
              <li key={r.id}>
                <AppRow row={r} onDeleted={refresh} />
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>

      <RegisterDialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v) refresh();
        }}
        onRegistered={(app) => {
          setJustCreated(app);
          setCreateOpen(false);
        }}
      />

      <CredentialsDialog
        app={justCreated}
        onClose={() => {
          setJustCreated(null);
          refresh();
        }}
      />
    </Card>
  );
}

function AppRow({ row, onDeleted }: { row: DeveloperAppRow; onDeleted: () => void }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  function del() {
    startTransition(async () => {
      const res = await deleteDeveloperAppAction(row.client_id);
      if (!res.ok) setErr(res.error);
      else onDeleted();
    });
  }

  function rotate() {
    startTransition(async () => {
      const res = await rotateDeveloperAppSecretAction(row.client_id);
      if (!res.ok) setErr(res.error);
      else setRotatedSecret(res.data.client_secret);
    });
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-foreground">
        {row.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{row.name}</p>
          {row.is_first_party && (
            <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              First-party
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] font-normal capitalize">
            {row.is_confidential ? "confidential" : "public"}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          client_id: <code>{row.client_id}</code>
        </p>
        {row.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.description}</p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">
          Status: {row.status} · Created: {new Date(row.created_at).toLocaleDateString()} · Last used: {row.last_used_at ? new Date(row.last_used_at).toLocaleString() : "never"} · Active sessions: {row.active_tokens}
        </p>
        <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
          {row.redirect_uris.map((uri) => (
            <p key={uri} className="truncate">redirect_uri: <code>{uri}</code></p>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {row.allowed_scopes.map((s) => (
            <Badge key={s} variant="outline" className="text-[10px] font-normal">
              {s}
            </Badge>
          ))}
        </div>
        {err && (
          <p className="mt-1 text-xs text-destructive" role="alert">{err}</p>
        )}
      </div>
      {!row.is_first_party && (
        <div className="flex shrink-0 items-start gap-1">
          {row.is_confidential && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={rotate}
              disabled={pending}
              aria-label={`Rotate secret for ${row.name}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={del}
            disabled={pending}
            aria-label={`Delete ${row.name}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      <Dialog open={!!rotatedSecret} onOpenChange={(v) => !v && setRotatedSecret(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New client_secret for {row.name}</DialogTitle>
          </DialogHeader>
          {rotatedSecret && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  client_secret
                </p>
                <CopyBlock value={rotatedSecret} />
                <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                  Store this secret safely — it is shown only once. The
                  previous secret is already invalid. Existing access and
                  refresh tokens keep working until they expire or you
                  explicitly revoke them.
                </p>
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setRotatedSecret(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RegisterDialog({
  open,
  onOpenChange,
  onRegistered,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRegistered: (app: NewlyRegisteredApp) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [homepage, setHomepage] = useState("");
  const [redirectUris, setRedirectUris] = useState("urn:ietf:wg:oauth:2.0:oob");
  const [authMethod, setAuthMethod] = useState<(typeof AUTH_METHODS)[number]["value"]>("public");
  const [scopes, setScopes] = useState<OAuthScope[]>(["context:read", "context:search"]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleScope(s: OAuthScope) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = redirectUris.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    startTransition(async () => {
      const res = await registerDeveloperAppAction({
        name,
        description: description || null,
        homepage_url: homepage || null,
        redirect_uris: parsed,
        scopes,
        is_confidential: authMethod === "confidential",
      });
      if (res.ok) {
        onRegistered(res.data);
        setName("");
        setDescription("");
        setHomepage("");
        setRedirectUris("urn:ietf:wg:oauth:2.0:oob");
        setAuthMethod("public");
        setScopes(["context:read", "context:search"]);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register OAuth app</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} required disabled={pending} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Description</span>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={pending} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Homepage URL</span>
            <Input value={homepage} onChange={(e) => setHomepage(e.target.value)} disabled={pending} placeholder="https://example.com" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Redirect URIs (one per line)
            </span>
            <textarea
              className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={redirectUris}
              onChange={(e) => setRedirectUris(e.target.value)}
              disabled={pending}
              required
            />
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Client type</legend>
            {AUTH_METHODS.map((m) => (
              <label key={m.value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="auth_method"
                  value={m.value}
                  checked={authMethod === m.value}
                  onChange={() => setAuthMethod(m.value)}
                  disabled={pending}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scopes</legend>
            {ALL_SCOPES.map((s) => (
              <label key={s} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={() => toggleScope(s)}
                  disabled={pending}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-medium text-foreground">{OAUTH_SCOPES[s].label}</p>
                  <p className="text-xs text-muted-foreground">{OAUTH_SCOPES[s].description}</p>
                </div>
              </label>
            ))}
          </fieldset>
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <div className={cn("flex justify-end gap-2", pending && "opacity-60")}>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Registering…" : "Register"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CredentialsDialog({
  app,
  onClose,
}: {
  app: NewlyRegisteredApp | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!app} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Credentials for {app?.client.name}</DialogTitle>
        </DialogHeader>
        {app && (
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                client_id
              </p>
              <CopyBlock value={app.client.client_id} />
            </div>
            {app.client_secret && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  client_secret
                </p>
                <CopyBlock value={app.client_secret} />
                <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                  This is the only time you will see this secret. Copy and
                  store it somewhere safe before closing this dialog.
                </p>
              </div>
            )}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Redirect URIs
              </p>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {app.client.redirect_uris.map((u) => (
                  <li key={u} className="truncate"><code>{u}</code></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Allowed scopes
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {app.client.allowed_scopes.map((s) => (
                  <Badge key={s} variant="outline" className="text-[10px] font-normal">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }
  return (
    <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
      <code className="flex-1 truncate text-xs font-mono">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={copy}
        aria-label="Copy"
        className="shrink-0 h-7 w-7 p-0"
      >
        {copied ? <X className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
