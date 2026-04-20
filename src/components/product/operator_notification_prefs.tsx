"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { setOperatorNotificationPrefsAction } from "@/app/app/workspace_operator/notification_actions";
import type { OperatorNotificationPrefs } from "@/server/services/operator_notifications_service";

/**
 * Notification preferences card for the operator settings page.
 *
 * Two checkboxes: email-on-complete (default off), email-on-fail
 * (default on). The card is initially seeded by the server page from
 * `getNotificationPrefs`; saves use `setOperatorNotificationPrefsAction`
 * which upserts and returns the canonical row.
 */

export interface OperatorNotificationPrefsCardProps {
  initialPrefs: OperatorNotificationPrefs;
}

export function OperatorNotificationPrefsCard({
  initialPrefs,
}: OperatorNotificationPrefsCardProps) {
  const [prefs, setPrefs] = useState<OperatorNotificationPrefs>(initialPrefs);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (status === "saved") {
      const t = setTimeout(() => setStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [status]);

  function toggle(key: keyof OperatorNotificationPrefs) {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
    setStatus("idle");
  }

  function handleSave() {
    setStatus("saving");
    setErrorMsg("");
    startTransition(async () => {
      const res = await setOperatorNotificationPrefsAction({
        emailOnComplete: prefs.emailOnComplete,
        emailOnFail: prefs.emailOnFail,
      });
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(res.error);
        return;
      }
      setPrefs(res.data);
      setStatus("saved");
    });
  }

  return (
    <Card id="operator-notifications">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Decide when the Workspace Operator should email you.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="space-y-4 pt-4">
        <ToggleRow
          id="email-on-complete"
          label="Email me when a run completes"
          description="Sent for successful runs once they finish writing notes."
          checked={prefs.emailOnComplete}
          onToggle={() => toggle("emailOnComplete")}
        />
        <ToggleRow
          id="email-on-fail"
          label="Email me when a run fails"
          description="Sent when a run errors out or is cancelled mid-flight."
          checked={prefs.emailOnFail}
          onToggle={() => toggle("emailOnFail")}
        />
        <div className="flex items-center justify-end gap-3 pt-1">
          {status === "saved" && (
            <p className="text-xs text-muted-foreground">Preferences saved.</p>
          )}
          {status === "error" && (
            <p className="text-xs text-destructive" role="alert">
              {errorMsg}
            </p>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={status === "saving"}
          >
            {status === "saving" ? "Saving..." : "Save preferences"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border px-4 py-3 hover:bg-muted/30 transition-colors"
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 shrink-0 accent-foreground"
      />
    </label>
  );
}
