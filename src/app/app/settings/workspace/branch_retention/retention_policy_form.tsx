"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Check, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { updateRetentionPolicyAction } from "./actions";

interface PolicyShape {
  enabled: boolean;
  warn_after_idle_days: number;
  auto_discard_after_days: number;
}

/**
 * Editable retention policy form. Admins see inputs + save button;
 * non-admins see the same values rendered read-only so the policy is
 * still discoverable without revealing an admin surface.
 */
export function RetentionPolicyForm({
  initial,
  canEdit,
}: {
  initial: PolicyShape;
  canEdit: boolean;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [warnDays, setWarnDays] = useState(initial.warn_after_idle_days);
  const [autoDays, setAutoDays] = useState(initial.auto_discard_after_days);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    enabled !== initial.enabled ||
    warnDays !== initial.warn_after_idle_days ||
    autoDays !== initial.auto_discard_after_days;

  function save() {
    if (warnDays <= 0 || autoDays <= 0) {
      setToast({ kind: "err", text: "Day counts must be positive." });
      return;
    }
    if (autoDays < warnDays) {
      setToast({
        kind: "err",
        text: "Auto-discard must be >= warn threshold.",
      });
      return;
    }
    startTransition(async () => {
      const res = await updateRetentionPolicyAction({
        enabled,
        warn_after_idle_days: warnDays,
        auto_discard_after_days: autoDays,
      });
      if (res.ok) {
        setToast({ kind: "ok", text: "Retention policy saved." });
      } else {
        setToast({ kind: "err", text: res.error });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold">
              Retention policy
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Idle branches are first warned, then discarded.
            </CardDescription>
          </div>
          {initial.enabled ? (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Check className="h-3 w-3" aria-hidden="true" />
              Enabled
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              Disabled
            </Badge>
          )}
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="flex flex-col gap-4 pt-5">
        {toast && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
              toast.kind === "ok"
                ? "border-border bg-accent/40"
                : "border-destructive/30 bg-destructive/5 text-destructive"
            )}
            role={toast.kind === "ok" ? "status" : "alert"}
          >
            {toast.kind === "err" ? (
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
            )}
            <p className="flex-1">{toast.text}</p>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit || pending}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span>Enable auto-warning and auto-discard for this workspace</span>
        </label>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Warn after idle days
            </span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={warnDays}
              onChange={(e) => setWarnDays(parseInt(e.target.value || "0", 10))}
              disabled={!canEdit || pending}
            />
            <span className="text-[11px] text-muted-foreground">
              A branch idle for this many days gets a warning banner.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Auto-discard after days
            </span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={autoDays}
              onChange={(e) => setAutoDays(parseInt(e.target.value || "0", 10))}
              disabled={!canEdit || pending}
            />
            <span className="text-[11px] text-muted-foreground">
              Must be &gt;= warn threshold. Runs on cleanup sweeps.
            </span>
          </label>
        </div>

        {canEdit && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              size="sm"
              onClick={save}
              disabled={!dirty || pending}
              title={!dirty ? "No changes" : undefined}
            >
              {pending ? "Saving…" : "Save policy"}
            </Button>
          </div>
        )}
        {!canEdit && (
          <p className="text-[11px] text-muted-foreground">
            Only workspace admins can change the retention policy.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
