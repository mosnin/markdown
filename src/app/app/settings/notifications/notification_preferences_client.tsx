"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { updateNotificationPreferencesAction } from "@/app/app/activity/actions";

// ─── Toggle item descriptors ────────────────────────────────────────────────

interface ToggleItem {
  key: PrefKey;
  label: string;
  description: string;
}

type PrefKey =
  | "note_created"
  | "note_updated"
  | "link_created"
  | "branch_promoted"
  | "member_joined"
  | "proposal_submitted";

const TOGGLE_ITEMS: ToggleItem[] = [
  {
    key: "note_created",
    label: "Note created",
    description: "When a new note is created in the workspace.",
  },
  {
    key: "note_updated",
    label: "Note updated",
    description: "When an existing note is edited by another member.",
  },
  {
    key: "link_created",
    label: "Link created",
    description: "When a new link between notes is created.",
  },
  {
    key: "branch_promoted",
    label: "Branch promoted",
    description: "When a draft branch is promoted to main.",
  },
  {
    key: "member_joined",
    label: "Member joined",
    description: "When a new member joins the workspace.",
  },
  {
    key: "proposal_submitted",
    label: "Proposal submitted",
    description: "When a write proposal is submitted for review.",
  },
];

const EMAIL_DIGEST_OPTIONS = [
  { value: "none", label: "None" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export function NotificationPreferencesClient({
  initialPrefs,
}: {
  initialPrefs: {
    note_created: boolean;
    note_updated: boolean;
    link_created: boolean;
    branch_promoted: boolean;
    member_joined: boolean;
    proposal_submitted: boolean;
    email_digest: "none" | "daily" | "weekly";
  };
}) {
  const [prefs, setPrefs] = useState(initialPrefs);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (status === "saved") {
      const t = setTimeout(() => setStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [status]);

  function togglePref(key: PrefKey) {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
    setStatus("idle");
  }

  function setEmailDigest(value: "none" | "daily" | "weekly") {
    setPrefs((p) => ({ ...p, email_digest: value }));
    setStatus("idle");
  }

  async function handleSave() {
    setStatus("saving");
    setErrorMsg("");
    const result = await updateNotificationPreferencesAction(prefs);
    if (result.ok) {
      setStatus("saved");
    } else {
      setStatus("error");
      setErrorMsg(result.error);
    }
  }

  return (
    <Card>
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">
          Activity Feed Events
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Toggle which events show up in your activity feed.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-4">
        {TOGGLE_ITEMS.map(({ key, label, description }) => (
          <label
            key={key}
            htmlFor={`notif-${key}`}
            className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border px-4 py-3 hover:bg-muted/30 transition-colors"
          >
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <input
              id={`notif-${key}`}
              type="checkbox"
              checked={prefs[key]}
              onChange={() => togglePref(key)}
              className="mt-0.5 shrink-0 accent-foreground"
            />
          </label>
        ))}

        {/* Email digest frequency */}
        <div className="rounded-lg border border-border px-4 py-3">
          <p className="text-sm font-medium text-foreground mb-1">
            Email digest
          </p>
          <p className="text-xs text-muted-foreground mb-2">
            Receive a summary email of workspace activity.
          </p>
          <div className="flex gap-2">
            {EMAIL_DIGEST_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setEmailDigest(value)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  prefs.email_digest === value
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center justify-end gap-3 pt-1">
          {status === "saved" && (
            <p className="text-xs text-muted-foreground">Preferences saved.</p>
          )}
          {status === "error" && (
            <p className="text-xs text-destructive">{errorMsg}</p>
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
