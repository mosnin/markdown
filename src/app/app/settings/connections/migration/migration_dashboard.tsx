"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  listLegacyConnectionsAction,
  deprecateLegacyConnectionAction,
  bulkDeprecateMigratedAction,
  type LegacyConnectionRow,
} from "./actions";
import { permissionModeToScopes } from "./scope_mapping";
import type { PermissionMode } from "@/server/domain/constants/connection_constants";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function permissionLabel(mode: PermissionMode): string {
  switch (mode) {
    case "read_only":
      return "Read only";
    case "propose_writes":
      return "Propose writes";
    case "generate_in_allowed_folders":
      return "Generate";
    default:
      return mode;
  }
}

function buildOAuthWizardUrl(conn: LegacyConnectionRow): string {
  const scopes = permissionModeToScopes(conn.permission_mode);
  const params = new URLSearchParams();
  params.set("name", conn.name);
  if (conn.description) params.set("description", conn.description);
  params.set("scopes", scopes.join(" "));
  params.set("from_migration", conn.id);
  return `/app/settings/oauth_clients/new?${params.toString()}`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function MigrationDashboard() {
  const [rows, setRows] = useState<LegacyConnectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();

  const refresh = () => {
    startLoad(async () => {
      const res = await listLegacyConnectionsAction();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const migrated = rows?.filter((r) => r.has_oauth_match) ?? [];
  const needsMigration = rows?.filter((r) => !r.has_oauth_match) ?? [];
  const canBulkDeprecate = migrated.some((r) => !r.deprecated_at);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      {rows && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            label="Total connections"
            value={rows.length}
            variant="default"
          />
          <SummaryCard
            label="Migrated"
            value={migrated.length}
            variant="success"
          />
          <SummaryCard
            label="Needs migration"
            value={needsMigration.length}
            variant={needsMigration.length > 0 ? "warning" : "success"}
          />
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Bulk actions */}
      {rows && rows.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {rows.length} connection{rows.length === 1 ? "" : "s"} in
            workspace
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Refresh
            </Button>
            {canBulkDeprecate && (
              <BulkDeprecateButton onDone={refresh} />
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {rows && rows.length === 0 && (
        <Card>
          <CardContent className="px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No legacy connections found in this workspace. You are already
              on OAuth.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {!rows && loading && (
        <Card>
          <CardContent className="px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Loading connections...
            </p>
          </CardContent>
        </Card>
      )}

      {/* Connection list */}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-3 list-none">
          {rows.map((row) => (
            <li key={row.id}>
              <ConnectionMigrationCard row={row} onDeprecated={refresh} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "default" | "success" | "warning";
}) {
  return (
    <Card>
      <CardContent className="px-4 py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            "mt-1 text-2xl font-semibold",
            variant === "success" && "text-success",
            variant === "warning" && "text-warning"
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Connection card ──────────────────────────────────────────────────────────

function ConnectionMigrationCard({
  row,
  onDeprecated,
}: {
  row: LegacyConnectionRow;
  onDeprecated: () => void;
}) {
  const scopes = permissionModeToScopes(row.permission_mode);

  return (
    <Card
      className={cn(
        row.deprecated_at &&
          "border-muted-foreground/20 bg-muted/30 opacity-80"
      )}
    >
      <CardHeader className="px-6 pt-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="truncate text-sm font-semibold">
                {row.name}
              </CardTitle>
              <MigrationBadge
                migrated={row.has_oauth_match}
                deprecated={!!row.deprecated_at}
              />
              <Badge variant="outline" className="text-[10px] font-normal">
                {row.status}
              </Badge>
            </div>
            {row.description && (
              <CardDescription className="mt-1 truncate text-xs">
                {row.description}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>

      <Separator />

      <CardContent className="px-6 pt-4 pb-5 space-y-4">
        {/* Connection details */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Permission mode
            </p>
            <p className="mt-0.5">{permissionLabel(row.permission_mode)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Active tokens
            </p>
            <p className="mt-0.5">{row.token_count}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Last used
            </p>
            <p className="mt-0.5">{formatDate(row.last_used_at)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Created
            </p>
            <p className="mt-0.5">{formatDate(row.created_at)}</p>
          </div>
        </div>

        {/* Scope mapping */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Mapped OAuth scopes
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {scopes.map((s) => (
              <Badge key={s} variant="outline" className="text-[10px] font-normal">
                {s}
              </Badge>
            ))}
          </div>
        </div>

        {/* OAuth match details */}
        {row.has_oauth_match && row.matched_oauth_client_name && (
          <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
            <CheckCircle2
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>
              Matched OAuth client:{" "}
              <span className="font-medium">
                {row.matched_oauth_client_name}
              </span>
            </span>
          </div>
        )}

        {/* Deprecated notice */}
        {row.deprecated_at && (
          <div className="flex items-center gap-2 rounded-md border border-muted-foreground/20 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <CheckCircle2
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>
              Deprecated on {formatDate(row.deprecated_at)}. Legacy tokens
              still resolve but emit audit warnings.
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          {!row.has_oauth_match && (
            <Button
              size="sm"
              render={<Link href={buildOAuthWizardUrl(row)} />}
            >
              Migrate to OAuth
              <ArrowRight
                className="ml-1 h-3.5 w-3.5"
                aria-hidden="true"
              />
            </Button>
          )}
          {row.has_oauth_match && !row.deprecated_at && (
            <DeprecateButton connectionId={row.id} onDone={onDeprecated} />
          )}
          {row.has_oauth_match && row.matched_oauth_client_id && (
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/app/settings/oauth_clients" />}
            >
              View OAuth client
              <ExternalLink
                className="ml-1 h-3.5 w-3.5"
                aria-hidden="true"
              />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Migration badge ──────────────────────────────────────────────────────────

function MigrationBadge({
  migrated,
  deprecated,
}: {
  migrated: boolean;
  deprecated: boolean;
}) {
  if (deprecated) {
    return (
      <Badge variant="secondary" className="text-[10px] font-normal">
        Deprecated
      </Badge>
    );
  }
  if (migrated) {
    return (
      <Badge variant="success" className="text-[10px] font-normal">
        Migrated
      </Badge>
    );
  }
  return (
    <Badge variant="warning" className="text-[10px] font-normal">
      Needs migration
    </Badge>
  );
}

// ─── Deprecate button ─────────────────────────────────────────────────────────

function DeprecateButton({
  connectionId,
  onDone,
}: {
  connectionId: string;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function deprecate() {
    setErr(null);
    startTransition(async () => {
      const res = await deprecateLegacyConnectionAction(connectionId);
      if (res.ok) {
        onDone();
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {err && (
        <p className="text-xs text-destructive" role="alert">
          {err}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={deprecate}
        disabled={pending}
      >
        {pending ? "Deprecating..." : "Deprecate legacy connection"}
      </Button>
    </div>
  );
}

// ─── Bulk deprecate button ────────────────────────────────────────────────────

function BulkDeprecateButton({ onDone }: { onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function bulkDeprecate() {
    setErr(null);
    setResult(null);
    startTransition(async () => {
      const res = await bulkDeprecateMigratedAction();
      if (res.ok) {
        setResult(
          `Deprecated ${res.data.count} connection${res.data.count === 1 ? "" : "s"}.`
        );
        onDone();
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {err && (
        <p className="text-xs text-destructive" role="alert">
          {err}
        </p>
      )}
      {result && (
        <p className="text-xs text-muted-foreground">{result}</p>
      )}
      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={bulkDeprecate}
        disabled={pending}
      >
        <AlertTriangle
          className="mr-1 h-3.5 w-3.5"
          aria-hidden="true"
        />
        {pending
          ? "Deprecating..."
          : "Deprecate all migrated connections"}
      </Button>
    </div>
  );
}
