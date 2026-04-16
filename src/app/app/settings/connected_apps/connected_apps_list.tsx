"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listConnectedAppsDetailAction,
  revokeConnectedAppByConsentAction,
  type ConnectedAppDetail,
} from "./actions";
import {
  SCOPE_DESCRIPTIONS,
  describeBoxScope,
  describeScope,
} from "@/lib/oauth_scope_descriptions";
import {
  isBoxScope,
  isCapabilityScope,
  parseBoxScope,
} from "@/server/services/oauth_scope_service";

/**
 * Connected Apps — client-side list with per-row revoke + scope
 * detail expansion. Revoking shows a confirmation dialog and a
 * short-lived toast with the number of tokens invalidated.
 */
export function ConnectedAppsList() {
  const [rows, setRows] = useState<ConnectedAppDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [toConfirm, setToConfirm] = useState<ConnectedAppDetail | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = () => {
    startLoad(async () => {
      const res = await listConnectedAppsDetailAction();
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

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const activeRows = useMemo(
    () => (rows ?? []).filter((r) => r.status === "active"),
    [rows]
  );
  const revokedRows = useMemo(
    () => (rows ?? []).filter((r) => r.status === "revoked"),
    [rows]
  );

  return (
    <div className="space-y-6">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"
        >
          {toast}
        </div>
      )}
      {error && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading connected apps…" : ""}
        </p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-8 text-center text-sm text-muted-foreground">
            <p>No connected apps yet.</p>
            <p className="mt-1 text-xs">
              When an OAuth app asks for access to your workspace, you&apos;ll
              see a consent screen. Approved apps appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {activeRows.length > 0 && (
            <section>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Active grants
              </h2>
              <ul className="flex flex-col gap-2 list-none">
                {activeRows.map((r) => (
                  <li key={r.consent_id}>
                    <AppRow row={r} onRevoke={() => setToConfirm(r)} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {revokedRows.length > 0 && (
            <section>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Revoked
              </h2>
              <ul className="flex flex-col gap-2 list-none">
                {revokedRows.map((r) => (
                  <li key={r.consent_id}>
                    <AppRow row={r} onRevoke={() => undefined} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <ConfirmRevokeDialog
        row={toConfirm}
        onClose={() => setToConfirm(null)}
        onConfirmed={(n) => {
          setToConfirm(null);
          setToast(
            n === 0
              ? "Access revoked."
              : `Access revoked. ${n} token${n === 1 ? "" : "s"} invalidated.`
          );
          refresh();
        }}
        onError={(msg) => setError(msg)}
      />
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function AppRow({
  row,
  onRevoke,
}: {
  row: ConnectedAppDetail;
  onRevoke: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lastUsed = row.last_used_at
    ? new Date(row.last_used_at).toLocaleString()
    : "never";

  // Collect scope groups
  const capScopes = row.scopes.filter(isCapabilityScope);
  const boxScopes = row.scopes.filter(isBoxScope);

  return (
    <Card className={cn(row.status === "revoked" && "opacity-60")}>
      <CardContent className="px-4 py-3">
        <div className="flex items-start gap-3">
          {row.logo_url ? (
            <Image
              src={row.logo_url}
              alt=""
              width={40}
              height={40}
              className="shrink-0 rounded-md"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-foreground">
              {row.client_name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold">{row.client_name}</p>
              {row.is_first_party ? (
                <Badge variant="success" className="gap-1 text-[10px]">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  First-party
                </Badge>
              ) : (
                <Badge variant="warning" className="gap-1 text-[10px]">
                  <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                  Third-party
                </Badge>
              )}
              {row.status === "revoked" && (
                <Badge variant="outline" className="text-[10px]">
                  Revoked
                </Badge>
              )}
              {row.homepage_url && (
                <a
                  href={row.homepage_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Homepage
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </div>
            {row.client_description && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {row.client_description}
              </p>
            )}
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
              <div className="truncate">
                <dt className="inline font-medium">Workspace:</dt>{" "}
                {row.workspace_name}
              </div>
              <div className="truncate">
                <dt className="inline font-medium">Granted:</dt>{" "}
                {new Date(row.granted_at).toLocaleDateString()}
              </div>
              <div className="truncate">
                <dt className="inline font-medium">Last used:</dt> {lastUsed}
              </div>
              <div className="truncate">
                <dt className="inline font-medium">Active sessions:</dt>{" "}
                {row.active_token_count}
              </div>
            </dl>

            <div className="mt-2 flex flex-wrap gap-1">
              {capScopes.map((s) => {
                if (!isCapabilityScope(s)) return null;
                const d = SCOPE_DESCRIPTIONS[s];
                return (
                  <Badge key={s} variant={d.badgeVariant} className="text-[10px]">
                    {s}
                  </Badge>
                );
              })}
              {boxScopes.length > 0 && (
                <Badge variant="info" className="text-[10px]">
                  {boxScopes.length} box{boxScopes.length === 1 ? "" : "es"}
                </Badge>
              )}
            </div>

            <button
              type="button"
              onClick={() => setExpanded((x) => !x)}
              aria-expanded={expanded}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" aria-hidden="true" />
                  Hide scope detail
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" aria-hidden="true" />
                  View scope detail
                </>
              )}
            </button>

            {expanded && (
              <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                {capScopes.map((s) => {
                  const d = describeScope(s);
                  return (
                    <div key={s} className="flex items-start gap-2">
                      <Badge
                        variant={d.badgeVariant}
                        className="mt-0.5 shrink-0 text-[10px]"
                      >
                        {s}
                      </Badge>
                      <div>
                        <p className="text-xs font-medium">{d.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {d.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {boxScopes.length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Access is limited to these boxes:
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-1 list-none">
                      {boxScopes.map((s) => {
                        const id = parseBoxScope(s);
                        const d = describeBoxScope(id ?? s, null);
                        return (
                          <li key={s}>
                            <Badge variant={d.badgeVariant} className="text-[10px]">
                              {d.title}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {row.status === "active" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRevoke}
              className="shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`Revoke access for ${row.client_name}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Confirm revoke dialog ───────────────────────────────────────────────────

function ConfirmRevokeDialog({
  row,
  onClose,
  onConfirmed,
  onError,
}: {
  row: ConnectedAppDetail | null;
  onClose: () => void;
  onConfirmed: (tokensRevoked: number) => void;
  onError: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!row) return;
    startTransition(async () => {
      const res = await revokeConnectedAppByConsentAction(row.consent_id);
      if (res.ok) onConfirmed(res.data.tokens_revoked);
      else onError(res.error);
    });
  }

  if (!row) return null;

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Revoke access for {row.client_name}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            The app will lose access to {row.workspace_name} immediately.
            Any open session using this grant will get a 401 on its next
            API call.
          </p>
          <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            <p>
              <strong>{row.active_token_count}</strong> active token
              {row.active_token_count === 1 ? "" : "s"} will be invalidated.
            </p>
            <p className="mt-1">
              The app can request access again later — you&apos;ll see a new
              consent screen if it does.
            </p>
          </div>
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
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={confirm}
              disabled={pending}
            >
              {pending ? "Revoking…" : "Revoke access"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
