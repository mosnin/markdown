"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createPromotionGateAction,
  deletePromotionGateAction,
  listPromotionGatesAction,
  rotatePromotionGateSecretAction,
  updatePromotionGateAction,
  type PromotionGateRow,
} from "./actions";

/**
 * Workspace admin surface for branch-promotion gates.
 *
 * The SSR page hands in `initialGates` (already admin-filtered). The
 * client handles the CRUD lifecycle + one-shot secret display. When a
 * gate is created or rotated, the returned secret is shown in a
 * banner-style dialog that can ONLY be dismissed by the admin — there
 * is no "close and come back to it" path, so the copy-to-clipboard
 * affordance is mandatory.
 */
export function PromotionGatesManager({
  initialGates,
}: {
  initialGates: PromotionGateRow[];
}) {
  const [rows, setRows] = useState<PromotionGateRow[]>(initialGates);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<{ name: string; secret: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PromotionGateRow | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const refresh = () => {
    startRefresh(async () => {
      const res = await listPromotionGatesAction();
      if (res.ok) {
        setRows(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      {error && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {rows.length} gate{rows.length === 1 ? "" : "s"} configured
        </p>
        <Button size="sm" type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Add gate
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-8 text-center text-sm text-muted-foreground">
            <p>No promotion gates configured.</p>
            <p className="mt-1 text-xs">
              Gates let you require an external CI/CD-style check to pass
              before a branch can be promoted to main.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2 list-none">
          {rows.map((r) => (
            <li key={r.id}>
              <GateRow
                row={r}
                onChanged={refresh}
                onDelete={() => setConfirmDelete(r)}
                onError={setError}
                onSecretRotated={(secret) =>
                  setJustCreated({ name: r.name, secret })
                }
              />
            </li>
          ))}
        </ul>
      )}

      {refreshing && (
        <p className="text-[11px] text-muted-foreground">Refreshing…</p>
      )}

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(gate, secret) => {
          setCreateOpen(false);
          setJustCreated({ name: gate.name, secret });
          refresh();
        }}
      />

      <SecretDialog
        payload={justCreated}
        onClose={() => setJustCreated(null)}
      />

      <DeleteDialog
        row={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirmed={() => {
          setConfirmDelete(null);
          refresh();
        }}
        onError={setError}
      />
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function GateRow({
  row,
  onChanged,
  onDelete,
  onError,
  onSecretRotated,
}: {
  row: PromotionGateRow;
  onChanged: () => void;
  onDelete: () => void;
  onError: (msg: string) => void;
  onSecretRotated: (secret: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(row.name);
  const [draftUrl, setDraftUrl] = useState(row.webhook_url);
  const [draftTimeout, setDraftTimeout] = useState(row.timeout_seconds);

  function toggleStatus() {
    startTransition(async () => {
      const newStatus = row.status === "active" ? "disabled" : "active";
      const res = await updatePromotionGateAction(row.id, { status: newStatus });
      if (!res.ok) onError(res.error);
      else onChanged();
    });
  }

  function saveEdit() {
    startTransition(async () => {
      const res = await updatePromotionGateAction(row.id, {
        name: draftName,
        webhookUrl: draftUrl,
        timeoutSeconds: draftTimeout,
      });
      if (!res.ok) onError(res.error);
      else {
        setEditing(false);
        onChanged();
      }
    });
  }

  function rotate() {
    startTransition(async () => {
      const res = await rotatePromotionGateSecretAction(row.id);
      if (!res.ok) onError(res.error);
      else onSecretRotated(res.data.secret);
    });
  }

  const isDisabled = row.status === "disabled";

  return (
    <Card className={cn(isDisabled && "opacity-70")}>
      <CardContent className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold">{row.name}</p>
              <Badge
                variant={isDisabled ? "warning" : "info"}
                className="text-[10px] capitalize"
              >
                {row.status}
              </Badge>
              {row.recent_runs.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {row.passed_count} passed · {row.failed_count} failed
                  {" (last 5)"}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              <code className="text-[11px]">{row.webhook_url}</code>
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Timeout: {row.timeout_seconds}s · Created{" "}
              {new Date(row.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing((v) => !v)}
              disabled={pending}
              title="Edit gate"
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleStatus}
              disabled={pending}
              title={isDisabled ? "Re-enable gate" : "Disable gate"}
            >
              {isDisabled ? (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={rotate}
              disabled={pending}
              title="Rotate secret"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={pending}
              className="text-destructive hover:text-destructive"
              title="Delete gate"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {editing && (
          <div className="mt-3 grid grid-cols-1 gap-2 border-t border-border pt-3">
            <label className="text-[11px] font-medium text-muted-foreground">
              Name
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="mt-0.5"
              />
            </label>
            <label className="text-[11px] font-medium text-muted-foreground">
              Webhook URL (https only)
              <Input
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                className="mt-0.5"
              />
            </label>
            <label className="text-[11px] font-medium text-muted-foreground">
              Timeout (seconds)
              <Input
                type="number"
                min={1}
                max={60}
                value={draftTimeout}
                onChange={(e) => setDraftTimeout(Number(e.target.value))}
                className="mt-0.5"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}

        {row.recent_runs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 border-t border-border pt-2">
            {row.recent_runs.map((r) => {
              const isPass = r.status === "passed";
              const Icon = isPass ? Check : r.status === "pending" ? RefreshCcw : X;
              return (
                <Badge
                  key={r.id}
                  variant="outline"
                  className={cn(
                    "gap-1 text-[10px]",
                    isPass
                      ? "border-emerald-600/40 text-emerald-700"
                      : r.status === "pending"
                      ? "border-muted-foreground/40 text-muted-foreground"
                      : "border-destructive/40 text-destructive"
                  )}
                  title={new Date(r.created_at).toLocaleString()}
                >
                  <Icon className="h-2.5 w-2.5" aria-hidden="true" />
                  {r.status}
                </Badge>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (gate: PromotionGateRow, secret: string) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [timeout, setTimeout] = useState(10);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setName("");
    setUrl("");
    setTimeout(10);
    setErr(null);
  }

  function submit() {
    setErr(null);
    startTransition(async () => {
      const res = await createPromotionGateAction({
        name,
        webhookUrl: url,
        timeoutSeconds: timeout,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      reset();
      onCreated(res.data.gate, res.data.secret);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a promotion gate</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {err && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
              {err}
            </p>
          )}
          <label className="block text-xs font-medium text-foreground">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              placeholder="e.g. Run integration tests"
            />
          </label>
          <label className="block text-xs font-medium text-foreground">
            Webhook URL
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="mt-1"
              placeholder="https://hooks.example.com/branch-gate"
            />
            <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
              Must be https. Loopback addresses are rejected.
            </span>
          </label>
          <label className="block text-xs font-medium text-foreground">
            Timeout (seconds)
            <Input
              type="number"
              min={1}
              max={60}
              value={timeout}
              onChange={(e) => setTimeout(Number(e.target.value))}
              className="mt-1"
            />
          </label>
        </div>
        <DialogFooter>
          <Button
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
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Create gate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SecretDialog({
  payload,
  onClose,
}: {
  payload: { name: string; secret: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!payload) return;
    navigator.clipboard.writeText(payload.secret).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={!!payload} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Signing secret for &ldquo;{payload?.name}&rdquo;</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p>
              This is the only time you will see this secret. Store it in
              your webhook handler&apos;s environment; if you lose it,
              rotate to generate a new one.
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <code className="block break-all font-mono text-xs">
              {payload?.secret ?? ""}
            </code>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Outbound requests are signed with header
            {" "}
            <code className="text-[11px]">X-ContextStore-Signature: v1=&lt;hmac-sha256-hex&gt;</code>
            . See the promotion gates v1 doc for the exact signing scheme.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={copy}>
            <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" onClick={onClose}>
            I&apos;ve saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  row,
  onClose,
  onConfirmed,
  onError,
}: {
  row: PromotionGateRow | null;
  onClose: () => void;
  onConfirmed: () => void;
  onError: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  function confirm() {
    if (!row) return;
    startTransition(async () => {
      const res = await deletePromotionGateAction(row.id);
      if (!res.ok) onError(res.error);
      else onConfirmed();
    });
  }

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{row?.name}&rdquo;?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This removes the gate and its run history. Branches can be
          promoted without this check immediately after deletion.
        </p>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={confirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
