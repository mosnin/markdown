"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArchiveX,
  Copy,
  Pencil,
  Plus,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  registerDeveloperAppAction,
  rotateDeveloperAppSecretAction,
  type NewlyRegisteredApp,
} from "../developer_apps_actions";
import {
  deprecateOauthClientAction,
  listOauthClientRowsAction,
  updateOauthClientAction,
  type OauthClientRow,
} from "./actions";
import {
  ALL_SCOPES,
  type OAuthCapabilityScope,
} from "@/server/services/oauth_scope_service";
import { SCOPE_DESCRIPTIONS } from "@/lib/oauth_scope_descriptions";

/**
 * OAuth clients manager.
 *
 * Entirely client-side state around three server actions:
 *   - listOauthClientRowsAction — list with telemetry
 *   - registerDeveloperAppAction — register (uses existing service)
 *   - updateOauthClientAction / deprecateOauthClientAction — row actions
 *
 * One-shot credential display: when registration returns a
 * `client_secret`, we store it in local component state and render a
 * dedicated dialog with a copy-to-clipboard button. Dismissing the
 * dialog forgets the secret — the UI cannot re-show it on refresh.
 */
export function OauthClientsManager({
  initialClients,
}: {
  initialClients: OauthClientRow[];
}) {
  const [rows, setRows] = useState<OauthClientRow[]>(initialClients);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<NewlyRegisteredApp | null>(null);
  const [editing, setEditing] = useState<OauthClientRow | null>(null);
  const [deprecating, setDeprecating] = useState<OauthClientRow | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const refresh = () => {
    startRefresh(async () => {
      const res = await listOauthClientRowsAction();
      if (res.ok) {
        setRows(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  };

  useEffect(() => {
    // Re-fetch on mount to populate aggregated telemetry that the SSR
    // initial render couldn't compute cheaply.
    refresh();
  }, []);

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {rows.length} client{rows.length === 1 ? "" : "s"} registered
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Register new client
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-8 text-center text-sm text-muted-foreground">
            <p>You haven&apos;t registered any OAuth clients yet.</p>
            <p className="mt-1 text-xs">
              Registered clients let third-party apps request access on
              behalf of users via the standard authorization-code flow.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2 list-none">
          {rows.map((r) => (
            <li key={r.client_id}>
              <ClientRow
                row={r}
                onEdit={() => setEditing(r)}
                onDeprecate={() => setDeprecating(r)}
                onError={setError}
              />
            </li>
          ))}
        </ul>
      )}

      {refreshing && (
        <p className="text-[11px] text-muted-foreground">Refreshing…</p>
      )}

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

      <EditDialog
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />

      <DeprecateDialog
        row={deprecating}
        onClose={() => setDeprecating(null)}
        onConfirmed={() => {
          setDeprecating(null);
          refresh();
        }}
      />
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function ClientRow({
  row,
  onEdit,
  onDeprecate,
  onError,
}: {
  row: OauthClientRow;
  onEdit: () => void;
  onDeprecate: () => void;
  onError: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  function rotate() {
    startTransition(async () => {
      const res = await rotateDeveloperAppSecretAction(row.client_id);
      if (!res.ok) onError(res.error);
      else setRotatedSecret(res.data.client_secret);
    });
  }

  const lastUsed = row.last_used_at
    ? new Date(row.last_used_at).toLocaleString()
    : "never";
  const isSuspended = row.status === "suspended";

  return (
    <Card className={cn(isSuspended && "opacity-70")}>
      <CardContent className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-foreground">
            {row.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold">{row.name}</p>
              {row.is_first_party && (
                <Badge variant="success" className="gap-1 text-[10px]">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  First-party
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] capitalize">
                {row.is_confidential ? "confidential" : "public"}
              </Badge>
              {isSuspended ? (
                <Badge variant="warning" className="text-[10px]">
                  Deprecated
                </Badge>
              ) : (
                <Badge variant="info" className="text-[10px] capitalize">
                  {row.status}
                </Badge>
              )}
            </div>
            {row.description && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {row.description}
              </p>
            )}
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
              <div className="truncate">
                <dt className="inline font-medium">client_id:</dt>{" "}
                <code className="text-[11px]">{row.client_id}</code>
              </div>
              <div className="truncate">
                <dt className="inline font-medium">Registered:</dt>{" "}
                {new Date(row.created_at).toLocaleDateString()}
              </div>
              <div className="truncate">
                <dt className="inline font-medium">Last used:</dt> {lastUsed}
              </div>
              <div className="truncate">
                <dt className="inline font-medium">Active grants:</dt>{" "}
                {row.active_consent_count} · {row.active_token_count} token
                {row.active_token_count === 1 ? "" : "s"}
              </div>
            </dl>

            {row.redirect_uris.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Redirect URIs
                </p>
                <ul className="mt-0.5 flex flex-wrap gap-1 list-none">
                  {row.redirect_uris.map((uri) => (
                    <li key={uri}>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] break-all">
                        {uri}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-1">
              {row.allowed_scopes.map((s) => (
                <Badge key={s} variant="outline" className="text-[10px]">
                  {s}
                </Badge>
              ))}
            </div>
          </div>

          {!row.is_first_party && (
            <div className="flex shrink-0 flex-col gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onEdit}
                disabled={pending || isSuspended}
                aria-label={`Edit ${row.name}`}
                className="h-7 w-7 p-0"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              {row.is_confidential && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={rotate}
                  disabled={pending}
                  aria-label={`Rotate secret for ${row.name}`}
                  className="h-7 w-7 p-0"
                >
                  <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDeprecate}
                disabled={pending || isSuspended}
                aria-label={`Deprecate ${row.name}`}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              >
                <ArchiveX className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>

      <Dialog
        open={!!rotatedSecret}
        onOpenChange={(v) => !v && setRotatedSecret(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New client_secret for {row.name}</DialogTitle>
          </DialogHeader>
          {rotatedSecret && (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                The previous secret is immediately invalid. Active sessions
                keep working until the tokens themselves expire — rotate is
                about the next handshake, not existing access.
              </p>
              <CopyBlock value={rotatedSecret} />
              <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                This is the only time you will see this secret.
              </p>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setRotatedSecret(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Register dialog ─────────────────────────────────────────────────────────

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
  const [isConfidential, setIsConfidential] = useState(false);
  const [scopes, setScopes] = useState<OAuthCapabilityScope[]>([
    "context:read",
    "context:search",
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setName("");
    setDescription("");
    setHomepage("");
    setRedirectUris("urn:ietf:wg:oauth:2.0:oob");
    setIsConfidential(false);
    setScopes(["context:read", "context:search"]);
    setError(null);
  }

  function toggleScope(s: OAuthCapabilityScope) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = redirectUris
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    startTransition(async () => {
      const res = await registerDeveloperAppAction({
        name,
        description: description || null,
        homepage_url: homepage || null,
        redirect_uris: parsed,
        scopes,
        is_confidential: isConfidential,
      });
      if (res.ok) {
        onRegistered(res.data);
        reset();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Register a new OAuth client</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={pending}
              placeholder="Acme MCP connector"
            />
          </Field>
          <Field label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
              placeholder="What this app does"
            />
          </Field>
          <Field label="Homepage URL">
            <Input
              value={homepage}
              onChange={(e) => setHomepage(e.target.value)}
              disabled={pending}
              placeholder="https://example.com"
            />
          </Field>
          <Field label="Redirect URIs" required hint="One per line. Use urn:ietf:wg:oauth:2.0:oob for CLI / headless apps.">
            <textarea
              className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={redirectUris}
              onChange={(e) => setRedirectUris(e.target.value)}
              disabled={pending}
              required
            />
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Client type
            </legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                checked={!isConfidential}
                onChange={() => setIsConfidential(false)}
                disabled={pending}
                className="mt-1"
              />
              <div>
                <p className="font-medium">Public (PKCE, no secret)</p>
                <p className="text-xs text-muted-foreground">
                  Desktop, mobile, and CLI apps that cannot safely store a
                  server-side secret. Mandatory for single-page apps.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                checked={isConfidential}
                onChange={() => setIsConfidential(true)}
                disabled={pending}
                className="mt-1"
              />
              <div>
                <p className="font-medium">Confidential (with client_secret)</p>
                <p className="text-xs text-muted-foreground">
                  Server-to-server apps that can hold a secret. You&apos;ll
                  see the secret once at registration.
                </p>
              </div>
            </label>
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Allowed scopes
            </legend>
            <ul className="mt-1 flex flex-col gap-1 list-none">
              {ALL_SCOPES.map((s) => {
                const d = SCOPE_DESCRIPTIONS[s];
                return (
                  <li key={s}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={scopes.includes(s)}
                        onChange={() => toggleScope(s)}
                        disabled={pending}
                        className="mt-1"
                      />
                      <div>
                        <p className="flex items-center gap-2 font-medium">
                          <span>{d.title}</span>
                          <Badge variant={d.badgeVariant} className="text-[10px]">
                            {s}
                          </Badge>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {d.description}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          {error && (
            <p className="text-xs text-destructive" role="alert">{error}</p>
          )}
          <div className={cn("flex justify-end gap-2", pending && "opacity-60")}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Registering…" : "Register client"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Credentials (one-shot) dialog ───────────────────────────────────────────

function CredentialsDialog({
  app,
  onClose,
}: {
  app: NewlyRegisteredApp | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!app} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
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
                  <AlertTriangle
                    className="mr-1 inline h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                  This is the only time you will see this secret. Store it
                  somewhere safe before closing this dialog. If you lose it,
                  you&apos;ll need to rotate the secret and update every
                  consumer.
                </p>
              </div>
            )}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Redirect URIs
              </p>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {app.client.redirect_uris.map((u) => (
                  <li key={u} className="truncate">
                    <code>{u}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={onClose}>
                I&apos;ve stored the secret
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit dialog ─────────────────────────────────────────────────────────────

function EditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: OauthClientRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Re-mount the inner form whenever the target row changes so each
  // mount's useState initializers pick up the right defaults. Cleaner
  // than keeping a bag of setState calls inside a useEffect.
  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        {row && (
          <EditDialogBody
            key={row.client_id}
            row={row}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditDialogBody({
  row,
  onClose,
  onSaved,
}: {
  row: OauthClientRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row.name ?? "");
  const [description, setDescription] = useState(row.description ?? "");
  const [homepage, setHomepage] = useState(row.homepage_url ?? "");
  const [redirectUris, setRedirectUris] = useState(
    (row.redirect_uris ?? []).join("\n")
  );
  const [scopes, setScopes] = useState<OAuthCapabilityScope[]>(
    (row.allowed_scopes ?? []).filter((s): s is OAuthCapabilityScope =>
      (ALL_SCOPES as readonly string[]).includes(s)
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleScope(s: OAuthCapabilityScope) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    const parsed = redirectUris
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    startTransition(async () => {
      const res = await updateOauthClientAction(row.client_id, {
        name: name.trim(),
        description: description.trim() || null,
        homepage_url: homepage.trim() || null,
        redirect_uris: parsed,
        allowed_scopes: scopes,
      });
      if (res.ok) onSaved();
      else setError(res.error);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {row.name}</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <Field label="Name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={pending}
          />
        </Field>
        <Field label="Description">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending}
          />
        </Field>
        <Field label="Homepage URL">
          <Input
            value={homepage}
            onChange={(e) => setHomepage(e.target.value)}
            disabled={pending}
            placeholder="https://example.com"
          />
        </Field>
        <Field label="Redirect URIs" required>
          <textarea
            className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={redirectUris}
            onChange={(e) => setRedirectUris(e.target.value)}
            disabled={pending}
            required
          />
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Allowed scopes
          </legend>
          <ul className="flex flex-col gap-1 list-none">
            {ALL_SCOPES.map((s) => (
              <li key={s}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={scopes.includes(s)}
                    onChange={() => toggleScope(s)}
                    disabled={pending}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium">{SCOPE_DESCRIPTIONS[s].title}</p>
                    <p className="text-xs text-muted-foreground">
                      {SCOPE_DESCRIPTIONS[s].description}
                    </p>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {error && (
          <p className="text-xs text-destructive" role="alert">{error}</p>
        )}
        <div className={cn("flex justify-end gap-2", pending && "opacity-60")}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </>
  );
}

// ─── Deprecate confirmation dialog ───────────────────────────────────────────

function DeprecateDialog({
  row,
  onClose,
  onConfirmed,
}: {
  row: OauthClientRow | null;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    if (!row) return;
    startTransition(async () => {
      const res = await deprecateOauthClientAction(row.client_id);
      if (res.ok) onConfirmed();
      else setError(res.error);
    });
  }

  if (!row) return null;

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Deprecate {row.name}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-sm text-muted-foreground">
            Deprecating prevents new authorizations. It does{" "}
            <strong>not</strong> revoke existing grants — users with active
            tokens can keep using the app until their tokens expire or they
            revoke access from Connected Apps.
          </p>
          <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            <p>
              <strong>{row.active_consent_count}</strong> active grant
              {row.active_consent_count === 1 ? "" : "s"} ·{" "}
              <strong>{row.active_token_count}</strong> active token
              {row.active_token_count === 1 ? "" : "s"}
            </p>
            <p className="mt-1">
              To also force-logout every existing session, open Connected
              Apps and revoke each consent individually.
            </p>
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">{error}</p>
          )}
          <div className={cn("flex justify-end gap-2", pending && "opacity-60")}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={pending}
            >
              Keep active
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={confirm}
              disabled={pending}
            >
              {pending ? "Deprecating…" : "Deprecate client"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
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
      <code className="flex-1 break-all text-xs font-mono">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={copy}
        aria-label="Copy"
        className="shrink-0 h-7 w-7 p-0"
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      {copied && <span className="text-[11px] text-success">Copied</span>}
    </div>
  );
}
