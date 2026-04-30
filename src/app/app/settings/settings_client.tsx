"use client";

import { useState, useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  updateProfileAction,
  updateThemeAction,
  changePasswordAction,
  updateNotificationsAction,
  updateWorkspaceAction,
  type Theme,
  type ChangePasswordState,
  type NotificationPreferences,
} from "./actions";
import type { WorkspacePlan } from "@/server/services/subscription_service";

// ─── Profile section ──────────────────────────────────────────────────────────

export function ProfileSection({
  email,
  displayName,
}: {
  email: string;
  displayName?: string;
}) {
  const initials = email.slice(0, 2).toUpperCase();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (status === "saved") {
      const t = setTimeout(() => setStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [status]);

  async function handleSubmit(formData: FormData) {
    setStatus("saving");
    setErrorMsg("");
    const result = await updateProfileAction(formData);
    if (result.ok) {
      setStatus("saved");
    } else {
      setStatus("error");
      setErrorMsg(result.error);
    }
  }

  return (
    <Card id="settings-profile">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Profile</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Your public-facing identity within Context Store.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground select-none">
            {initials}
          </div>
          <div className="flex flex-col gap-1">
            <Button variant="outline" size="sm" type="button">
              Change avatar
            </Button>
            <p className="text-xs text-muted-foreground">
              JPG, PNG, or WebP. Max 2 MB.
            </p>
          </div>
        </div>

        {/* Fields */}
        <form action={handleSubmit}>
          <div className="grid gap-y-4 sm:grid-cols-2 sm:gap-x-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="display-name"
                className="text-sm font-medium text-foreground"
              >
                Display name
              </label>
              <Input
                id="display-name"
                name="display_name"
                defaultValue={displayName ?? ""}
                placeholder="Your name"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="email"
                className="text-sm font-medium text-foreground"
              >
                Email address
              </label>
              <Input
                id="email"
                defaultValue={email}
                placeholder="you@example.com"
                type="email"
                disabled
              />
              <p className="text-xs text-muted-foreground">
                Changing your email requires re-verification.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4">
            {status === "saved" && (
              <p className="text-xs text-muted-foreground">Changes saved.</p>
            )}
            {status === "error" && (
              <p className="text-xs text-destructive">{errorMsg}</p>
            )}
            <Button size="sm" type="submit" disabled={status === "saving"}>
              {status === "saving" ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Appearance section ───────────────────────────────────────────────────────

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function AppearanceSection({
  currentTheme,
}: {
  currentTheme?: Theme;
}) {
  const [selected, setSelected] = useState<Theme>(currentTheme ?? "system");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  async function handleSave() {
    setStatus("saving");
    setErrorMsg("");
    const result = await updateThemeAction(selected);
    if (result.ok) {
      setStatus("saved");
    } else {
      setStatus("error");
      setErrorMsg(result.error);
    }
  }

  return (
    <Card id="settings-appearance">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Appearance</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Control the visual presentation of Context Store.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-5">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="theme-selector"
            className="text-sm font-medium text-foreground"
          >
            Theme
          </label>
          <div className="flex gap-2" id="theme-selector">
            {THEMES.map(({ value, label }) => (
              <Button
                key={value}
                type="button"
                variant={selected === value ? "default" : "outline"}
                size="sm"
                className="min-w-[80px]"
                onClick={() => {
                  setSelected(value);
                  setStatus("idle");
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Theme toggle is also available in the sidebar. This setting persists
            your preference.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          {status === "saved" && (
            <p className="text-xs text-muted-foreground">Theme saved.</p>
          )}
          {status === "error" && (
            <p className="text-xs text-destructive">{errorMsg}</p>
          )}
          <Button
            size="sm"
            type="button"
            disabled={status === "saving"}
            onClick={handleSave}
          >
            {status === "saving" ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Notifications section ────────────────────────────────────────────────────

const NOTIFICATION_ITEMS = [
  {
    key: "activity" as const,
    id: "notif-activity",
    label: "Activity updates",
    description: "Get notified when teammates comment or make changes.",
  },
  {
    key: "security" as const,
    id: "notif-security",
    label: "Security alerts",
    description: "Receive alerts for new sign-ins and sensitive account changes.",
  },
  {
    key: "announcements" as const,
    id: "notif-product",
    label: "Product announcements",
    description: "Occasional emails about new features and improvements.",
  },
];

export function NotificationsSection({
  initialActivity,
  initialSecurity,
  initialAnnouncements,
}: {
  initialActivity: boolean;
  initialSecurity: boolean;
  initialAnnouncements: boolean;
}) {
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    activity: initialActivity,
    security: initialSecurity,
    announcements: initialAnnouncements,
  });
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (status === "saved") {
      const t = setTimeout(() => setStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [status]);

  function toggle(key: keyof NotificationPreferences) {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
    setStatus("idle");
  }

  async function handleSave() {
    setStatus("saving");
    setErrorMsg("");
    const result = await updateNotificationsAction(prefs);
    if (result.ok) {
      setStatus("saved");
    } else {
      setStatus("error");
      setErrorMsg(result.error);
    }
  }

  return (
    <Card id="settings-notifications">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Notifications</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Choose when and how you receive notifications.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-4">
        {NOTIFICATION_ITEMS.map(({ key, id, label, description }) => (
          <label
            key={id}
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
              checked={prefs[key]}
              onChange={() => toggle(key)}
              className="mt-0.5 shrink-0 accent-foreground"
            />
          </label>
        ))}

        <div className="flex items-center justify-end gap-3 pt-1">
          {status === "saved" && (
            <p className="text-xs text-muted-foreground">Preferences saved.</p>
          )}
          {status === "error" && (
            <p className="text-xs text-destructive">{errorMsg}</p>
          )}
          <Button
            size="sm"
            type="button"
            disabled={status === "saving"}
            onClick={handleSave}
          >
            {status === "saving" ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Workspace section ────────────────────────────────────────────────────────

export function WorkspaceSection({
  initialName,
  initialDescription,
  initialAgentInstructions,
}: {
  initialName: string;
  initialDescription: string | null;
  initialAgentInstructions: string | null;
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (status === "saved") {
      const t = setTimeout(() => setStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [status]);

  async function handleSubmit(formData: FormData) {
    setStatus("saving");
    setErrorMsg("");
    const result = await updateWorkspaceAction(formData);
    if (result.ok) {
      setStatus("saved");
    } else {
      setStatus("error");
      setErrorMsg(result.error);
    }
  }

  return (
    <Card id="settings-workspace">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Workspace</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Update your workspace name and description.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6">
        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="workspace-name"
              className="text-sm font-medium text-foreground"
            >
              Workspace name
            </label>
            <Input
              id="workspace-name"
              name="name"
              defaultValue={initialName}
              placeholder="My workspace"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="workspace-description"
              className="text-sm font-medium text-foreground"
            >
              Description
            </label>
            <Textarea
              id="workspace-description"
              name="description"
              defaultValue={initialDescription ?? ""}
              placeholder="What is this workspace for?"
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="workspace-agent-instructions"
              className="text-sm font-medium text-foreground"
            >
              Poggle instructions
            </label>
            <Textarea
              id="workspace-agent-instructions"
              name="agent_instructions"
              defaultValue={initialAgentInstructions ?? ""}
              placeholder="Workspace-wide rules Poggle should follow on every run — tone, required citations, forbidden topics, etc."
              rows={5}
              maxLength={4000}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Injected into every Poggle run in this workspace. Box-level
              instructions stack on top of these.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            {status === "saved" && (
              <p className="text-xs text-muted-foreground">Workspace updated.</p>
            )}
            {status === "error" && (
              <p className="text-xs text-destructive">{errorMsg}</p>
            )}
            <Button size="sm" type="submit" disabled={status === "saving"}>
              {status === "saving" ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Billing section ─────────────────────────────────────────────────────────

function UsageBar({
  label,
  current,
  max,
}: {
  label: string;
  current: number;
  max: number;
}) {
  const pct = Math.min(100, Math.round((current / max) * 100));
  const isNearLimit = pct >= 80;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className={isNearLimit ? "text-amber-600 font-medium" : ""}>
          {current}&nbsp;/&nbsp;{max}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isNearLimit ? "bg-amber-500" : "bg-foreground/40"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export interface OperatorUsageSummaryProps {
  runCount: number;
  toolCallCount: number;
  inputTokenCount: number;
  outputTokenCount: number;
  estimatedCostCents: number;
}

export function BillingSection({
  plan,
  subscriptionStatus,
  noteCount,
  noteMax,
  boxCount,
  boxMax,
  operatorUsage,
  operatorRunLimit,
}: {
  plan: WorkspacePlan;
  subscriptionStatus: string | null;
  noteCount: number;
  noteMax: number;
  boxCount: number;
  boxMax: number;
  /** Current-month Workspace Operator usage rollup. Optional so older callers still compile. */
  operatorUsage?: OperatorUsageSummaryProps;
  /**
   * Per-tier run limit for the Workspace Operator. Null means "unknown /
   * unlimited" — surfaced as just the count with no denominator.
   * Populated by Agent B's tier-enforcement work.
   */
  operatorRunLimit?: number | null;
}) {
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [portalPending, setPortalPending] = useState(false);
  const [billingError, setBillingError] = useState<string>("");

  const isPastDue = subscriptionStatus === "past_due";

  async function handleCheckout() {
    setCheckoutPending(true);
    setBillingError("");
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setBillingError(json.error ?? "Failed to start checkout");
        return;
      }
      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
      }
    } catch {
      setBillingError("Unexpected error. Please try again.");
    } finally {
      setCheckoutPending(false);
    }
  }

  async function handlePortal() {
    setPortalPending(true);
    setBillingError("");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setBillingError(json.error ?? "Failed to open billing portal");
        return;
      }
      if (json.portalUrl) {
        window.location.href = json.portalUrl;
      }
    } catch {
      setBillingError("Unexpected error. Please try again.");
    } finally {
      setPortalPending(false);
    }
  }

  return (
    <Card id="settings-billing">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Billing &amp; Plans</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Manage your subscription and usage.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-5">
        {/* Past-due warning banner */}
        {isPastDue && (
          <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
            <p className="text-sm font-medium text-destructive">
              Payment failed &mdash; update your payment method to keep Pro access.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto shrink-0 border-destructive text-destructive hover:bg-destructive/10"
              disabled={portalPending}
              onClick={handlePortal}
            >
              {portalPending ? "Loading…" : "Update payment method"}
            </Button>
          </div>
        )}

        {/* Error feedback */}
        {billingError && (
          <p className="text-sm text-destructive">{billingError}</p>
        )}

        {/* Current plan */}
        {plan === "pro" || plan === "business" ? (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {plan === "business" ? "Business plan" : "Pro plan"}
                </p>
                <Badge variant="secondary" className="text-xs">Active</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {plan === "business"
                  ? "Unlimited notes and boxes. Team features and high operator quota."
                  : "Unlimited notes and boxes. $12\u00a0/\u00a0month."}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={portalPending}
              onClick={handlePortal}
            >
              {portalPending ? "Loading…" : "Manage billing"}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">Free plan</p>
                  <Badge variant="secondary" className="text-xs">Current</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  $0&nbsp;/&nbsp;month &middot; No credit card required
                </p>
                {/* Usage */}
                <div className="mt-2 flex flex-col gap-1.5">
                  <UsageBar label="Notes" current={noteCount} max={noteMax} />
                  <UsageBar label="Boxes" current={boxCount} max={boxMax} />
                </div>
              </div>
            </div>

            {/* Upgrade CTA */}
            <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-foreground">
                  Upgrade to Pro &mdash; $12&nbsp;/&nbsp;month
                </p>
                <p className="text-sm text-muted-foreground">
                  Unlimited notes, unlimited boxes, and priority support.
                </p>
              </div>
              {/* Form POST for CSRF safety; JS intercepts to handle JSON response */}
              <form
                method="POST"
                action="/api/billing/checkout"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCheckout();
                }}
              >
                <Button
                  type="submit"
                  size="sm"
                  disabled={checkoutPending}
                >
                  {checkoutPending ? "Loading…" : "Upgrade to Pro"}
                </Button>
              </form>
            </div>
          </>
        )}

        {/*
          Workspace Operator metered usage — populated by the
          workspace_operator_usage rollup table. The run-limit denominator
          is optional; Agent B's tier work fills it in once Business /
          tier-specific quotas ship. Rendering is unconditional so users
          can see usage on free and paid plans alike.
        */}
        {operatorUsage && (
          <OperatorUsageSubsection
            usage={operatorUsage}
            runLimit={operatorRunLimit ?? null}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Workspace Operator usage subsection of the Billing card. Rendered under
 * the plan-specific block (free usage bars / pro "Manage billing" control)
 * so it's visible on every tier.
 *
 * Values are current-month aggregates summed across every user of the
 * workspace. Cost is a best-effort estimate based on the pricing table in
 * `workspace_operator_usage_service.MODEL_PRICING`.
 */
export function OperatorUsageSubsection({
  usage,
  runLimit,
}: {
  usage: OperatorUsageSummaryProps;
  runLimit: number | null;
}) {
  const totalTokens = usage.inputTokenCount + usage.outputTokenCount;
  const runsLabel =
    runLimit != null
      ? `${usage.runCount} / ${runLimit}`
      : `${usage.runCount}`;

  // Format cents as USD with two decimal places. Values under $0.01 are
  // shown as "< $0.01" rather than "$0.00" so we don't imply free usage.
  const dollars = usage.estimatedCostCents / 100;
  const costLabel =
    usage.estimatedCostCents === 0
      ? "$0.00"
      : dollars < 0.01
        ? "< $0.01"
        : `$${dollars.toFixed(2)}`;

  return (
    <div
      data-testid="operator-usage-subsection"
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">
          Workspace Operator usage
        </p>
        <p className="text-xs text-muted-foreground">
          Current month totals across all members of this workspace.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <OperatorUsageStat
          label="Runs"
          value={runsLabel}
          hint={runLimit == null ? "Unlimited" : undefined}
        />
        <OperatorUsageStat
          label="Tool calls"
          value={`${usage.toolCallCount}`}
        />
        <OperatorUsageStat
          label="Tokens"
          value={`${totalTokens}`}
          hint={
            totalTokens > 0
              ? `${usage.inputTokenCount} in / ${usage.outputTokenCount} out`
              : undefined
          }
        />
        <OperatorUsageStat label="Estimated cost" value={costLabel} />
      </div>
    </div>
  );
}

function OperatorUsageStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="flex flex-col gap-0.5"
      title={hint}
    >
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums text-foreground">
        {value}
      </span>
      {hint && (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

// ─── Security section ─────────────────────────────────────────────────────────

const INITIAL_PASSWORD_STATE: ChangePasswordState = { status: "idle" };

export function SecuritySection() {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    INITIAL_PASSWORD_STATE
  );

  return (
    <Card id="settings-security">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Security</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Manage your password and active sessions.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-5">
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="current-password"
              className="text-sm font-medium text-foreground"
            >
              Current password
            </label>
            <Input
              id="current-password"
              name="currentPassword"
              type="password"
              placeholder="Enter current password"
              autoComplete="current-password"
              disabled={pending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="new-password"
              className="text-sm font-medium text-foreground"
            >
              New password
            </label>
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              disabled={pending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="confirm-password"
              className="text-sm font-medium text-foreground"
            >
              Confirm new password
            </label>
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              placeholder="Repeat new password"
              autoComplete="new-password"
              disabled={pending}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            {state.status === "success" && (
              <p className="text-xs text-muted-foreground">Password updated.</p>
            )}
            {state.status === "error" && (
              <p role="alert" className="text-xs text-destructive">
                {state.message}
              </p>
            )}
            <Button size="sm" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
