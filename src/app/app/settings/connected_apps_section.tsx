"use client";

import { useEffect, useState, useTransition } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listConnectedAppsAction,
  revokeConnectedAppAction,
  type ConnectedAppRow,
} from "./oauth_actions";

/**
 * User-facing management of OAuth connectors.
 *
 * Every row represents a (client, workspace) grant. Users see the
 * scopes granted, when they last called in, and a single-click
 * revocation. Secrets never surface here — this is deliberately a
 * consent-management view, not a credentials view.
 */
export function ConnectedAppsSection() {
  const [rows, setRows] = useState<ConnectedAppRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [revoking, startRevoke] = useTransition();

  const refresh = () => {
    startLoad(async () => {
      const res = await listConnectedAppsAction();
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

  function revoke(row: ConnectedAppRow) {
    startRevoke(async () => {
      const res = await revokeConnectedAppAction(row.client_id, row.workspace_id);
      if (res.ok) refresh();
      else setError(res.error);
    });
  }

  return (
    <Card id="settings-connected-apps">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Connected apps</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          MCP connectors (Claude Desktop, OpenAI apps, custom integrations)
          that you have approved to access your workspaces. Revoke any
          connector to immediately invalidate its tokens.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-4">
        {error && (
          <p className="text-sm text-destructive" role="alert">{error}</p>
        )}
        {!rows ? (
          <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "No connectors loaded."}</p>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            No connected apps yet. When an MCP connector asks for access
            you&apos;ll see a consent screen and the approved connector will
            appear here.
          </div>
        ) : (
          <ul className="flex flex-col gap-2 list-none">
            {rows.map((r) => (
              <li key={`${r.client_id}:${r.workspace_id}`}>
                <AppRow row={r} onRevoke={() => revoke(r)} revoking={revoking} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AppRow({
  row,
  onRevoke,
  revoking,
}: {
  row: ConnectedAppRow;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const lastUsed = row.last_used_at
    ? new Date(row.last_used_at).toLocaleString()
    : "never";
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-foreground">
        {row.client_name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{row.client_name}</p>
          {row.is_first_party && (
            <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              First-party
            </Badge>
          )}
        </div>
        {row.client_description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.client_description}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {row.scopes.map((s) => (
            <Badge key={s} variant="outline" className="text-[10px] font-normal">
              {s}
            </Badge>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Workspace: {row.workspace_name} · Status: {row.status} · Last used: {lastUsed} · {row.active_tokens} active session{row.active_tokens === 1 ? "" : "s"}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRevoke}
        disabled={revoking || row.status === "revoked"}
        className="shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={`Revoke ${row.client_name}`}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
