"use client";

import { useState, useTransition } from "react";
import {
  Plus,
  RotateCcw,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Key,
  Zap,
  Webhook,
  Pause,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type Connection,
  type ConnectionBoxScope,
} from "@/server/domain/types/connection";
import {
  CONNECTION_TYPE,
  CONNECTION_STATUS,
  PERMISSION_MODE,
  type ConnectionType,
  type ConnectionStatus,
  type PermissionMode,
} from "@/server/domain/constants/connection_constants";
import {
  createConnectionAction,
  rotateTokenAction,
  revokeConnectionAction,
  toggleConnectionPauseAction,
} from "@/app/app/settings/connections_actions";
import type { Box } from "@/server/domain/types/box";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectionWithScopes = Connection & {
  box_scopes: ConnectionBoxScope[];
  token_expires_at: string | null;
};

// ─── Labels ───────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<ConnectionType, string> = {
  mcp: "MCP",
  api_token: "API Token",
  internal: "Internal",
};

const TYPE_ICON: Record<ConnectionType, React.ElementType> = {
  mcp: Zap,
  api_token: Key,
  internal: Webhook,
};

const PERMISSION_LABEL: Record<PermissionMode, string> = {
  read_only: "Read only",
  propose_writes: "Propose writes",
  generate_in_allowed_folders: "Generate in allowed folders",
};

const PERMISSION_DESCRIPTION: Record<PermissionMode, string> = {
  read_only:
    "Read-only access to notes, folders, and metadata. No writes of any kind are permitted.",
  propose_writes:
    "Can submit write proposals that require a human to review and approve before any change is applied. No direct writes.",
  generate_in_allowed_folders:
    "Can write directly to folders that have 'accepts generated notes' enabled. All other folders remain read-only.",
};

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; className: string }
> = {
  active:  { label: "Active",  className: "text-success border-success/30 bg-success/10" },
  paused:  { label: "Paused",  className: "text-warning border-warning/30 bg-warning/10" },
  revoked: { label: "Revoked", className: "text-destructive border-destructive/30 bg-destructive/10" },
};

// ─── Token reveal dialog ──────────────────────────────────────────────────────

function TokenRevealDialog({
  rawToken,
  onClose,
  isRotate,
}: {
  rawToken: string;
  onClose: () => void;
  isRotate?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(rawToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" aria-hidden />
      <div className="relative z-10 flex w-full max-w-lg flex-col gap-4 rounded-xl border border-border bg-background p-6 shadow-lg">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {isRotate ? "Token rotated" : "Connection created"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            This is the only time you will see this token. Store it securely.
          </p>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-700/30 dark:bg-amber-900/10">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Cannot be recovered
            </p>
          </div>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
            This token will not be shown again. If you lose it, rotate to
            generate a new one.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-xs font-mono text-foreground whitespace-nowrap">
            {rawToken}
          </code>
          <button
            onClick={handleCopy}
            className="shrink-0 rounded-md border border-border p-2 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title="Copy token"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Create connection dialog ─────────────────────────────────────────────────

function CreateConnectionDialog({
  boxes,
  onCreated,
  onClose,
}: {
  boxes: Box[];
  onCreated: (connection: ConnectionWithScopes, rawToken: string) => void;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [connectionType, setConnectionType] = useState<ConnectionType>("api_token");
  const [permissionMode, setPermissionMode] =
    useState<PermissionMode>("read_only");
  const [selectedBoxIds, setSelectedBoxIds] = useState<Set<string>>(new Set());

  function toggleBox(boxId: string) {
    setSelectedBoxIds((prev) => {
      const next = new Set(prev);
      if (next.has(boxId)) {
        next.delete(boxId);
      } else {
        next.add(boxId);
      }
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    selectedBoxIds.forEach((id) => formData.append("box_ids", id));

    startTransition(async () => {
      const result = await createConnectionAction(formData);
      if (result.ok) {
        onCreated(
          {
            ...result.data.connection,
            token_expires_at: null,
            box_scopes: Array.from(selectedBoxIds).map((box_id) => ({
              id: "",
              connection_id: result.data.connection.id,
              box_id,
              created_at: new Date().toISOString(),
            })),
          },
          result.data.rawToken
        );
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex w-full max-w-lg flex-col gap-4 rounded-xl border border-border bg-background p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Create connection
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Connections grant external agents scoped access via bearer tokens.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Name
            </label>
            <Input
              name="name"
              placeholder="My MCP client"
              required
              autoFocus
              className="text-sm"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Description (optional)
            </label>
            <Input
              name="description"
              placeholder="What is this connection for?"
              className="text-sm"
            />
          </div>

          {/* Connection type */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Type
            </label>
            <div className="flex gap-2">
              {(
                [
                  CONNECTION_TYPE.API_TOKEN,
                  CONNECTION_TYPE.MCP,
                  CONNECTION_TYPE.INTERNAL,
                ] as ConnectionType[]
              ).map((type) => {
                const Icon = TYPE_ICON[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setConnectionType(type)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors",
                      connectionType === type
                        ? "border-foreground/30 bg-muted/40 text-foreground font-medium"
                        : "border-border text-muted-foreground hover:bg-muted/20"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {TYPE_LABEL[type]}
                  </button>
                );
              })}
            </div>
            <input type="hidden" name="connection_type" value={connectionType} />
          </div>

          {/* Permission mode */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Permission mode
            </label>
            <div className="flex flex-col gap-1.5">
              {(
                [
                  PERMISSION_MODE.READ_ONLY,
                  PERMISSION_MODE.PROPOSE_WRITES,
                  PERMISSION_MODE.GENERATE_IN_ALLOWED_FOLDERS,
                ] as PermissionMode[]
              ).map((mode) => (
                <label
                  key={mode}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors",
                    permissionMode === mode
                      ? "border-foreground/30 bg-muted/30"
                      : "border-border hover:bg-muted/10"
                  )}
                >
                  <input
                    type="radio"
                    name="permission_mode"
                    value={mode}
                    checked={permissionMode === mode}
                    onChange={() => setPermissionMode(mode)}
                    className="mt-0.5 shrink-0"
                  />
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      {PERMISSION_LABEL[mode]}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {PERMISSION_DESCRIPTION[mode]}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Box scopes */}
          {boxes.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Allowed boxes
              </label>
              <div className="flex flex-col gap-1">
                {boxes.map((box) => (
                  <label
                    key={box.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2 hover:bg-muted/10 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedBoxIds.has(box.id)}
                      onChange={() => toggleBox(box.id)}
                      className="shrink-0"
                    />
                    <span className="text-xs text-foreground">{box.name}</span>
                    {box.slug && (
                      <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                        {box.slug}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              {selectedBoxIds.size === 0 && (
                <p className="text-[10px] text-muted-foreground/70">
                  No boxes selected — this connection will have no data access.
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Creating…" : "Create connection"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Connection card ──────────────────────────────────────────────────────────

function ConnectionCard({
  connection,
  boxes,
  onRevoked,
  onRotated,
  onStatusChanged,
}: {
  connection: ConnectionWithScopes;
  boxes: Box[];
  onRevoked: (id: string) => void;
  onRotated: (rawToken: string) => void;
  onStatusChanged: (updated: ConnectionWithScopes) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [isPending, startTransition] = useTransition();

  const TypeIcon = TYPE_ICON[connection.connection_type];
  const scopedBoxes = boxes.filter((b) =>
    connection.box_scopes.some((s) => s.box_id === b.id)
  );

  const lastUsed = connection.last_used_at
    ? new Date(connection.last_used_at).toLocaleDateString()
    : "Never";

  const tokenExpiryLabel = (() => {
    if (!connection.token_expires_at) return null;
    const expiryDate = new Date(connection.token_expires_at);
    const now = new Date();
    const diffMs = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return "Expired";
    if (diffDays <= 14)
      return `Expires in ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
    return `Expires ${expiryDate.toLocaleDateString()}`;
  })();

  function handleRotate() {
    startTransition(async () => {
      const result = await rotateTokenAction(connection.id);
      if (result.ok) {
        onRotated(result.data.rawToken);
      }
      setConfirmRotate(false);
    });
  }

  function handleRevoke() {
    startTransition(async () => {
      const result = await revokeConnectionAction(connection.id);
      if (result.ok) {
        onRevoked(connection.id);
      }
      setConfirmRevoke(false);
    });
  }

  function handleTogglePause() {
    startTransition(async () => {
      const result = await toggleConnectionPauseAction(connection.id);
      if (result.ok) {
        onStatusChanged({ ...connection, status: result.data.status });
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <TypeIcon className="h-4 w-4 text-muted-foreground" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground truncate">
              {connection.name}
            </p>
            <Badge variant="secondary" className="text-[10px] font-normal shrink-0">
              {TYPE_LABEL[connection.connection_type]}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] font-normal shrink-0"
            >
              {PERMISSION_LABEL[connection.permission_mode]}
            </Badge>
            {connection.status !== CONNECTION_STATUS.ACTIVE && (
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium shrink-0",
                  STATUS_CONFIG[connection.status].className
                )}
              >
                {STATUS_CONFIG[connection.status].label}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Last used: {lastUsed}
            {scopedBoxes.length > 0 && (
              <span className="ml-2">
                · {scopedBoxes.length} box{scopedBoxes.length !== 1 ? "es" : ""}
              </span>
            )}
            {tokenExpiryLabel && (
              <span
                className={cn(
                  "ml-2",
                  tokenExpiryLabel === "Expired" ||
                    tokenExpiryLabel.startsWith("Expires in")
                    ? "text-warning"
                    : ""
                )}
              >
                · {tokenExpiryLabel}
              </span>
            )}
          </p>
        </div>

        <button
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/40"
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 flex flex-col gap-3">
          {connection.description && (
            <p className="text-xs text-muted-foreground">{connection.description}</p>
          )}

          {/* Usage stats */}
          <div className="flex gap-4 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Usage</p>
              <p className="text-foreground/80">
                {connection.usage_count === 0
                  ? "Never used"
                  : `${connection.usage_count} request${connection.usage_count !== 1 ? "s" : ""}`}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Status</p>
              <p
                className={cn(
                  "text-xs",
                  connection.status === CONNECTION_STATUS.ACTIVE
                    ? "text-foreground/80"
                    : connection.status === CONNECTION_STATUS.PAUSED
                    ? "text-warning"
                    : "text-destructive"
                )}
              >
                {STATUS_CONFIG[connection.status].label}
              </p>
            </div>
          </div>

          {/* Scoped boxes */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Box access
            </p>
            {scopedBoxes.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {scopedBoxes.map((b) => (
                  <span
                    key={b.id}
                    className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-foreground/80"
                  >
                    {b.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground/60">
                No boxes — this connection has no data access.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
            {/* Rotate token — with confirmation */}
            {confirmRotate ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Rotate token?</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRotate}
                  disabled={isPending}
                  className="h-7 px-2.5 text-xs"
                >
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRotate(false)}
                  className="h-7 px-2.5 text-xs"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmRotate(true)}
                disabled={
                  isPending ||
                  connection.status !== CONNECTION_STATUS.ACTIVE
                }
                className="h-7 px-2.5 text-xs gap-1.5"
              >
                <RotateCcw className="h-3 w-3" />
                Rotate token
              </Button>
            )}

            {/* Pause / unpause — only when neither confirm dialog is open */}
            {!confirmRotate && !confirmRevoke && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTogglePause}
                disabled={isPending}
                className="h-7 px-2.5 text-xs gap-1.5"
              >
                {connection.status === CONNECTION_STATUS.PAUSED ? (
                  <>
                    <Play className="h-3 w-3" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="h-3 w-3" />
                    Pause
                  </>
                )}
              </Button>
            )}

            {/* Revoke — with confirmation */}
            {confirmRevoke ? (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-destructive">Revoke this connection?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRevoke}
                  disabled={isPending}
                  className="h-7 px-2.5 text-xs"
                >
                  Confirm
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRevoke(false)}
                  className="h-7 px-2.5 text-xs"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              !confirmRotate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRevoke(true)}
                  disabled={isPending}
                  className="h-7 px-2.5 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                >
                  <Trash2 className="h-3 w-3" />
                  Revoke
                </Button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Connections panel ────────────────────────────────────────────────────────

interface ConnectionsPanelProps {
  initialConnections: ConnectionWithScopes[];
  boxes: Box[];
}

export function ConnectionsPanel({
  initialConnections,
  boxes,
}: ConnectionsPanelProps) {
  const [connections, setConnections] =
    useState<ConnectionWithScopes[]>(initialConnections);
  const [showCreate, setShowCreate] = useState(false);
  const [revealToken, setRevealToken] = useState<{
    rawToken: string;
    isRotate: boolean;
  } | null>(null);

  function handleCreated(connection: ConnectionWithScopes, rawToken: string) {
    setConnections((prev) => [connection, ...prev]);
    setShowCreate(false);
    setRevealToken({ rawToken, isRotate: false });
  }

  function handleRevoked(id: string) {
    setConnections((prev) => prev.filter((c) => c.id !== id));
  }

  function handleRotated(rawToken: string) {
    setRevealToken({ rawToken, isRotate: true });
  }

  function handleStatusChanged(updated: ConnectionWithScopes) {
    setConnections((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c))
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Connections</CardTitle>
              <CardDescription>
                Bearer token credentials for external agents, MCP clients, and
                API integrations. Scoped to specific boxes.
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              className="shrink-0"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              New connection
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {connections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No connections yet
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Create a connection to grant an external agent access to your
                content.
              </p>
            </div>
          ) : (
            connections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                connection={conn}
                boxes={boxes}
                onRevoked={handleRevoked}
                onRotated={handleRotated}
                onStatusChanged={handleStatusChanged}
              />
            ))
          )}

          <p className="text-[10px] text-muted-foreground/60 pt-1">
            Tokens use the format{" "}
            <code className="font-mono">csk_v1_...</code>. Secrets are stored
            as hashes — they cannot be recovered, only rotated.
          </p>
        </CardContent>
      </Card>

      {showCreate && (
        <CreateConnectionDialog
          boxes={boxes}
          onCreated={handleCreated}
          onClose={() => setShowCreate(false)}
        />
      )}

      {revealToken && (
        <TokenRevealDialog
          rawToken={revealToken.rawToken}
          isRotate={revealToken.isRotate}
          onClose={() => setRevealToken(null)}
        />
      )}
    </>
  );
}
