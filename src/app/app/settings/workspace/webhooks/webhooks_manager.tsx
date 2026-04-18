"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Pause,
  Play,
  Plus,
  Send,
  ShieldCheck,
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
  createContentWebhookAction,
  deleteContentWebhookAction,
  listContentWebhooksAction,
  sendTestWebhookEventAction,
  updateContentWebhookAction,
  type ContentWebhookRow,
} from "./actions";
import { SUPPORTED_EVENT_TYPES } from "@/server/services/content_webhook_service";

/**
 * Workspace admin surface for content webhooks.
 *
 * The SSR page hands in `initialWebhooks` (already admin-filtered). The
 * client handles the CRUD lifecycle + one-shot secret display. When a
 * webhook is created, the returned secret is shown in a banner-style
 * dialog that can ONLY be dismissed by the admin.
 */
export function ContentWebhooksManager({
  initialWebhooks,
}: {
  initialWebhooks: ContentWebhookRow[];
}) {
  const [rows, setRows] = useState<ContentWebhookRow[]>(initialWebhooks);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<{ name: string; secret: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ContentWebhookRow | null>(null);
  const [expandedDeliveries, setExpandedDeliveries] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const refresh = () => {
    startRefresh(async () => {
      const res = await listContentWebhooksAction();
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

      {toast && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
            toast.kind === "ok"
              ? "border-border bg-accent/40"
              : "border-destructive/30 bg-destructive/5 text-destructive",
          )}
          role={toast.kind === "ok" ? "status" : "alert"}
        >
          {toast.kind === "err" ? (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldCheck
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
              aria-hidden="true"
            />
          )}
          <p className="flex-1">{toast.text}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {rows.length} webhook{rows.length === 1 ? "" : "s"} configured
        </p>
        <Button size="sm" type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Add webhook
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-8 text-center text-sm text-muted-foreground">
            <p>No content webhooks configured.</p>
            <p className="mt-1 text-xs">
              Webhooks let you receive HTTP notifications when notes,
              links, files, branches, or members change in this workspace.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2 list-none">
          {rows.map((r) => (
            <li key={r.id}>
              <WebhookRow
                row={r}
                onChanged={refresh}
                onDelete={() => setConfirmDelete(r)}
                onError={setError}
                onToast={setToast}
                isDeliveryExpanded={expandedDeliveries === r.id}
                onToggleDeliveries={() =>
                  setExpandedDeliveries((prev) => (prev === r.id ? null : r.id))
                }
              />
            </li>
          ))}
        </ul>
      )}

      {refreshing && (
        <p className="text-[11px] text-muted-foreground">Refreshing...</p>
      )}

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(webhook, secret) => {
          setCreateOpen(false);
          setJustCreated({ name: webhook.name, secret });
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

// ─── Row ────────────────────────────────────────────────────────────────────

function WebhookRow({
  row,
  onChanged,
  onDelete,
  onError,
  onToast,
  isDeliveryExpanded,
  onToggleDeliveries,
}: {
  row: ContentWebhookRow;
  onChanged: () => void;
  onDelete: () => void;
  onError: (msg: string) => void;
  onToast: (t: { kind: "ok" | "err"; text: string }) => void;
  isDeliveryExpanded: boolean;
  onToggleDeliveries: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [testing, startTest] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(row.name);
  const [draftUrl, setDraftUrl] = useState(row.url);
  const [draftEventTypes, setDraftEventTypes] = useState<string[]>(row.event_types);

  function sendTest() {
    startTest(async () => {
      const res = await sendTestWebhookEventAction(row.id);
      if (res.ok) {
        onToast({ kind: "ok", text: "Test event sent — check delivery log" });
        onChanged();
      } else {
        onToast({ kind: "err", text: res.error });
      }
    });
  }

  function toggleStatus() {
    startTransition(async () => {
      const newStatus = row.status === "active" ? "disabled" : "active";
      const res = await updateContentWebhookAction(row.id, { status: newStatus });
      if (!res.ok) onError(res.error);
      else onChanged();
    });
  }

  function saveEdit() {
    startTransition(async () => {
      const res = await updateContentWebhookAction(row.id, {
        name: draftName,
        url: draftUrl,
        eventTypes: draftEventTypes,
      });
      if (!res.ok) onError(res.error);
      else {
        setEditing(false);
        onChanged();
      }
    });
  }

  const isDisabled = row.status === "disabled";
  const deliveredCount = row.recent_deliveries.filter((d) => d.status === "delivered").length;
  const failedCount = row.recent_deliveries.filter((d) => d.status === "failed").length;

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
              {row.recent_deliveries.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {deliveredCount} delivered, {failedCount} failed (last 20)
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              <code className="text-[11px]">{row.url}</code>
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {row.event_types.map((et) => (
                <Badge key={et} variant="outline" className="text-[10px]">
                  {et}
                </Badge>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Created {new Date(row.created_at).toLocaleDateString()}
              {row.last_delivery_at && (
                <> &middot; Last delivery {new Date(row.last_delivery_at).toLocaleString()}</>
              )}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={sendTest}
              disabled={pending || testing || isDisabled}
              title={
                isDisabled
                  ? "Re-enable the webhook to send a test event"
                  : "Send a signed test.event to this endpoint"
              }
            >
              <Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {testing ? "Sending..." : "Send test"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing((v) => !v)}
              disabled={pending || testing}
              title="Edit webhook"
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleStatus}
              disabled={pending || testing}
              title={isDisabled ? "Re-enable webhook" : "Disable webhook"}
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
              onClick={onToggleDeliveries}
              disabled={pending || testing}
              title="Recent deliveries"
            >
              Deliveries
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={pending || testing}
              className="text-destructive hover:text-destructive"
              title="Delete webhook"
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
            <fieldset className="space-y-1">
              <legend className="text-[11px] font-medium text-muted-foreground">
                Event types
              </legend>
              <div className="flex flex-wrap gap-2">
                {SUPPORTED_EVENT_TYPES.map((et) => (
                  <label key={et} className="flex items-center gap-1 text-[11px] text-foreground">
                    <input
                      type="checkbox"
                      checked={draftEventTypes.includes(et)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setDraftEventTypes((prev) => [...prev, et]);
                        } else {
                          setDraftEventTypes((prev) => prev.filter((t) => t !== et));
                        }
                      }}
                      className="h-3 w-3"
                    />
                    {et}
                  </label>
                ))}
              </div>
            </fieldset>
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
                {pending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        )}

        {isDeliveryExpanded && row.recent_deliveries.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-2 text-[11px] font-medium text-muted-foreground">
              Recent deliveries (last 20)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-1 pr-3 font-medium">Event</th>
                    <th className="pb-1 pr-3 font-medium">Status</th>
                    <th className="pb-1 pr-3 font-medium">HTTP</th>
                    <th className="pb-1 pr-3 font-medium">Attempts</th>
                    <th className="pb-1 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {row.recent_deliveries.map((d) => (
                    <tr key={d.id} className="border-b border-border/50">
                      <td className="py-1 pr-3">{d.event_type}</td>
                      <td className="py-1 pr-3">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            d.status === "delivered"
                              ? "border-emerald-600/40 text-emerald-700"
                              : d.status === "pending"
                              ? "border-muted-foreground/40 text-muted-foreground"
                              : "border-destructive/40 text-destructive",
                          )}
                        >
                          {d.status === "delivered" && (
                            <Check className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
                          )}
                          {d.status === "failed" && (
                            <X className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
                          )}
                          {d.status}
                        </Badge>
                      </td>
                      <td className="py-1 pr-3">{d.response_status ?? "-"}</td>
                      <td className="py-1 pr-3">{d.attempts}</td>
                      <td className="py-1">{new Date(d.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isDeliveryExpanded && row.recent_deliveries.length === 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">No deliveries yet.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Dialogs ────────────────────────────────────────────────────────────────

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (webhook: ContentWebhookRow, secret: string) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setName("");
    setUrl("");
    setSelectedEvents([]);
    setErr(null);
  }

  function submit() {
    setErr(null);
    if (selectedEvents.length === 0) {
      setErr("Select at least one event type");
      return;
    }
    startTransition(async () => {
      const res = await createContentWebhookAction({
        name,
        url,
        eventTypes: selectedEvents,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      reset();
      onCreated(res.data.webhook, res.data.secret);
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
          <DialogTitle>Add a content webhook</DialogTitle>
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
              placeholder="e.g. Slack notification"
            />
          </label>
          <label className="block text-xs font-medium text-foreground">
            Webhook URL
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="mt-1"
              placeholder="https://hooks.example.com/content"
            />
            <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
              Must be https. Loopback addresses are rejected.
            </span>
          </label>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-foreground">
              Event types
            </legend>
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_EVENT_TYPES.map((et) => (
                <label key={et} className="flex items-center gap-1 text-[11px] text-foreground">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(et)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedEvents((prev) => [...prev, et]);
                      } else {
                        setSelectedEvents((prev) => prev.filter((t) => t !== et));
                      }
                    }}
                    className="h-3 w-3"
                  />
                  {et}
                </label>
              ))}
            </div>
          </fieldset>
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
            {pending ? "Creating..." : "Create webhook"}
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
              you will need to delete and re-create the webhook.
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
            . Verify by computing HMAC-SHA256 over &quot;timestamp.body&quot; using this secret.
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
  row: ContentWebhookRow | null;
  onClose: () => void;
  onConfirmed: () => void;
  onError: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  function confirm() {
    if (!row) return;
    startTransition(async () => {
      const res = await deleteContentWebhookAction(row.id);
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
          This removes the webhook and its delivery history. Events will
          no longer be sent to this endpoint.
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
            {pending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
