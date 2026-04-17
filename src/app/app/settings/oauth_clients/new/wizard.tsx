"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { z } from "zod";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  registerDeveloperAppAction,
  type NewlyRegisteredApp,
} from "../../developer_apps_actions";
import {
  ALL_SCOPES,
  type OAuthCapabilityScope,
} from "@/server/services/oauth_scope_service";
import {
  SCOPE_DESCRIPTIONS,
  SCOPE_GROUP_LABELS,
  type ScopeGroup,
  anyWriteCapable,
} from "@/lib/oauth_scope_descriptions";
import { isValidRedirectUri, redirectUriError } from "../wizard_validators";

/**
 * Multi-step OAuth client setup wizard.
 *
 * Holds all wizard state in a single client component. Step flow:
 *
 *   1. basics      — name (req), description, homepage, client type.
 *   2. redirects   — at least one URI; https-or-loopback enforced.
 *   3. scopes      — grouped checkboxes; ≥1 required; amber warning
 *                    when any write-capable scope is selected.
 *   4. review      — summary + Create button.
 *   5. credentials — one-shot display of client_id + secret + sample
 *                    authorize URL (copy buttons).
 *   6. done        — terminal success screen linking out to list +
 *                    Connected Apps.
 *
 * Keeps the existing register-dialog code intact; the dialog path
 * is still callable if any deep link points at it, but the primary
 * CTA in the list page now routes here.
 */

type ClientType = "public" | "confidential";

type Step = "basics" | "redirects" | "scopes" | "review" | "credentials" | "done";

const STEP_ORDER: Step[] = [
  "basics",
  "redirects",
  "scopes",
  "review",
  "credentials",
  "done",
];

const BasicsSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  description: z.string().max(500).optional(),
  homepage_url: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => {
        if (!v) return true;
        try {
          new URL(v);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Homepage must be a valid URL." }
    ),
  client_type: z.enum(["public", "confidential"]),
});

export function OauthClientWizard() {
  const [step, setStep] = useState<Step>("basics");

  // Basics
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [homepage, setHomepage] = useState("");
  const [clientType, setClientType] = useState<ClientType>("public");

  // Redirect URIs
  const [redirectUris, setRedirectUris] = useState<string[]>([""]);

  // Scopes
  const [scopes, setScopes] = useState<OAuthCapabilityScope[]>([
    "context:read",
    "context:search",
  ]);

  // Result
  const [registered, setRegistered] = useState<NewlyRegisteredApp | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ─── Step validation ─────────────────────────────────────────────────

  const basicsError = useMemo((): string | null => {
    const res = BasicsSchema.safeParse({
      name,
      description: description || undefined,
      homepage_url: homepage || undefined,
      client_type: clientType,
    });
    if (res.success) return null;
    return res.error.issues[0]?.message ?? "Invalid input.";
  }, [name, description, homepage, clientType]);

  const cleanedUris = useMemo(
    () => redirectUris.map((u) => u.trim()).filter(Boolean),
    [redirectUris]
  );
  const redirectsError = useMemo((): string | null => {
    if (cleanedUris.length === 0) return "At least one redirect URI is required.";
    for (const u of cleanedUris) {
      const err = redirectUriError(u);
      if (err) return `${u}: ${err}`;
    }
    return null;
  }, [cleanedUris]);

  const scopesError = useMemo((): string | null => {
    if (scopes.length === 0) return "Select at least one scope.";
    return null;
  }, [scopes]);

  const hasWriteScope = useMemo(() => anyWriteCapable(scopes), [scopes]);

  function goNext() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx < 0 || idx === STEP_ORDER.length - 1) return;
    setStep(STEP_ORDER[idx + 1]);
  }
  function goPrev() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx <= 0) return;
    setStep(STEP_ORDER[idx - 1]);
  }

  function submit() {
    setSubmitError(null);
    startTransition(async () => {
      const res = await registerDeveloperAppAction({
        name: name.trim(),
        description: description.trim() || null,
        homepage_url: homepage.trim() || null,
        redirect_uris: cleanedUris,
        scopes,
        is_confidential: clientType === "confidential",
      });
      if (res.ok) {
        setRegistered(res.data);
        setStep("credentials");
      } else {
        setSubmitError(res.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <WizardStepper current={step} />

      {step === "basics" && (
        <BasicsStep
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          homepage={homepage}
          setHomepage={setHomepage}
          clientType={clientType}
          setClientType={setClientType}
          error={basicsError}
        />
      )}

      {step === "redirects" && (
        <RedirectsStep
          redirectUris={redirectUris}
          setRedirectUris={setRedirectUris}
        />
      )}

      {step === "scopes" && (
        <ScopesStep
          scopes={scopes}
          setScopes={setScopes}
          hasWriteScope={hasWriteScope}
          error={scopesError}
        />
      )}

      {step === "review" && (
        <ReviewStep
          name={name}
          description={description}
          homepage={homepage}
          clientType={clientType}
          redirectUris={cleanedUris}
          scopes={scopes}
          hasWriteScope={hasWriteScope}
        />
      )}

      {step === "credentials" && registered && (
        <CredentialsStep app={registered} scopes={scopes} />
      )}

      {step === "done" && <DoneStep />}

      {submitError && step === "review" && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {submitError}
        </p>
      )}

      {/* Navigation */}
      {step !== "credentials" && step !== "done" && (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={pending || step === "basics"}
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Back
          </Button>
          {step === "review" ? (
            <Button type="button" size="sm" onClick={submit} disabled={pending}>
              {pending ? "Creating…" : "Create client"}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={goNext}
              disabled={
                pending ||
                (step === "basics" && !!basicsError) ||
                (step === "redirects" && !!redirectsError) ||
                (step === "scopes" && !!scopesError)
              }
            >
              Next
              <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      )}

      {step === "credentials" && (
        <div className="flex items-center justify-end">
          <Button type="button" size="sm" onClick={() => setStep("done")}>
            I&apos;ve saved the credentials
            <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Stepper ───────────────────────────────────────────────────────────

function WizardStepper({ current }: { current: Step }) {
  const labels: Record<Step, string> = {
    basics: "Basics",
    redirects: "Redirect URIs",
    scopes: "Scopes",
    review: "Review",
    credentials: "Credentials",
    done: "Done",
  };
  const currentIdx = STEP_ORDER.indexOf(current);
  return (
    <ol
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground list-none"
      aria-label="Wizard progress"
    >
      {STEP_ORDER.map((s, i) => {
        const active = i === currentIdx;
        const done = i < currentIdx;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[10px] font-semibold",
                active && "border-foreground bg-foreground text-background",
                done && "border-success/50 bg-success/10 text-success",
                !active && !done && "border-border"
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="h-3 w-3" aria-hidden="true" /> : i + 1}
            </span>
            <span className={cn(active && "text-foreground font-medium")}>
              {labels[s]}
            </span>
            {i < STEP_ORDER.length - 1 && (
              <span aria-hidden="true" className="text-muted-foreground/40">
                /
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Step 1: Basics ────────────────────────────────────────────────────

function BasicsStep(props: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  homepage: string;
  setHomepage: (v: string) => void;
  clientType: ClientType;
  setClientType: (v: ClientType) => void;
  error: string | null;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 px-6 py-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">Basics</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Tell us about the app that will connect via OAuth.
          </p>
        </div>
        <Field label="Name" required>
          <Input
            value={props.name}
            onChange={(e) => props.setName(e.target.value)}
            placeholder="Acme MCP connector"
            required
          />
        </Field>
        <Field label="Description">
          <Input
            value={props.description}
            onChange={(e) => props.setDescription(e.target.value)}
            placeholder="What this app does — shown on the consent screen."
          />
        </Field>
        <Field label="Homepage URL">
          <Input
            value={props.homepage}
            onChange={(e) => props.setHomepage(e.target.value)}
            placeholder="https://example.com"
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Client type
          </legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="client_type"
              checked={props.clientType === "public"}
              onChange={() => props.setClientType("public")}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-medium">Public (PKCE, no secret)</p>
              <p className="text-xs text-muted-foreground">
                Desktop, mobile, and CLI apps that cannot safely store a
                server-side secret. Mandatory for single-page apps.
              </p>
            </div>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="client_type"
              checked={props.clientType === "confidential"}
              onChange={() => props.setClientType("confidential")}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-medium">
                Confidential (with client_secret)
              </p>
              <p className="text-xs text-muted-foreground">
                Server-to-server apps that can hold a secret. You&apos;ll see the
                secret once at the end.
              </p>
            </div>
          </label>
        </fieldset>
        {props.error && (
          <p className="text-xs text-destructive" role="alert">
            {props.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Step 2: Redirect URIs ─────────────────────────────────────────────

function RedirectsStep(props: {
  redirectUris: string[];
  setRedirectUris: (v: string[]) => void;
}) {
  function update(i: number, v: string) {
    const next = [...props.redirectUris];
    next[i] = v;
    props.setRedirectUris(next);
  }
  function remove(i: number) {
    if (props.redirectUris.length === 1) {
      props.setRedirectUris([""]);
      return;
    }
    const next = props.redirectUris.filter((_, j) => j !== i);
    props.setRedirectUris(next);
  }
  function add() {
    props.setRedirectUris([...props.redirectUris, ""]);
  }

  return (
    <Card>
      <CardContent className="space-y-4 px-6 py-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Redirect URIs
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            At least one is required. HTTPS everywhere, or{" "}
            <code className="rounded bg-muted px-1">http://localhost</code> for
            development. Custom schemes and non-loopback{" "}
            <code className="rounded bg-muted px-1">http://</code> are rejected.
          </p>
        </div>
        <ul className="flex flex-col gap-2 list-none">
          {props.redirectUris.map((u, i) => {
            const err = u.trim() ? redirectUriError(u) : null;
            const ok = u.trim() && isValidRedirectUri(u);
            return (
              <li key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={u}
                    onChange={(e) => update(i, e.target.value)}
                    placeholder="https://app.example.com/oauth/callback"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(i)}
                    aria-label="Remove redirect URI"
                    className="h-8 w-8 p-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
                {err && (
                  <p className="text-[11px] text-destructive" role="alert">
                    {err}
                  </p>
                )}
                {ok && (
                  <p className="text-[11px] text-success">Looks good.</p>
                )}
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          className="w-fit"
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Add another
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Step 3: Scopes ────────────────────────────────────────────────────

function ScopesStep(props: {
  scopes: OAuthCapabilityScope[];
  setScopes: (v: OAuthCapabilityScope[]) => void;
  hasWriteScope: boolean;
  error: string | null;
}) {
  function toggle(s: OAuthCapabilityScope) {
    props.setScopes(
      props.scopes.includes(s)
        ? props.scopes.filter((x) => x !== s)
        : [...props.scopes, s]
    );
  }

  // Group scopes by SCOPE_DESCRIPTIONS.group for visual sectioning.
  const groups: Record<ScopeGroup, OAuthCapabilityScope[]> = {
    read: [],
    propose: [],
    generate: [],
    branch: [],
  };
  for (const s of ALL_SCOPES) {
    const g = SCOPE_DESCRIPTIONS[s].group;
    groups[g].push(s);
  }

  const groupOrder: ScopeGroup[] = ["read", "propose", "generate", "branch"];

  return (
    <Card>
      <CardContent className="space-y-4 px-6 py-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">Scopes</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Select the permissions this app may request. Users will still see and
            approve these on the consent screen.
          </p>
        </div>
        {groupOrder.map((g) => {
          const items = groups[g];
          if (items.length === 0) return null;
          return (
            <div key={g} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {SCOPE_GROUP_LABELS[g]}
              </p>
              <ul className="flex flex-col gap-2 list-none">
                {items.map((s) => {
                  const d = SCOPE_DESCRIPTIONS[s];
                  return (
                    <li key={s}>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={props.scopes.includes(s)}
                          onChange={() => toggle(s)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <p className="flex items-center gap-2 text-sm font-medium">
                            <span>{d.title}</span>
                            <Badge
                              variant={d.badgeVariant}
                              className="text-[10px]"
                            >
                              {s}
                            </Badge>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {d.description}
                          </p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {props.hasWriteScope && (
          <p
            className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning"
            role="status"
          >
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>
              You&apos;ve selected a write-capable scope. Users will see this
              flagged in the consent dialog, and writes will be audit-logged
              against the caller.
            </span>
          </p>
        )}
        {props.error && (
          <p className="text-xs text-destructive" role="alert">
            {props.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Step 4: Review ────────────────────────────────────────────────────

function ReviewStep(props: {
  name: string;
  description: string;
  homepage: string;
  clientType: ClientType;
  redirectUris: string[];
  scopes: OAuthCapabilityScope[];
  hasWriteScope: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 px-6 py-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">Review</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Confirm the details below, then create the client. You&apos;ll get
            the credentials on the next step.
          </p>
        </div>
        <SummaryRow label="Name" value={props.name} />
        {props.description && (
          <SummaryRow label="Description" value={props.description} />
        )}
        {props.homepage && (
          <SummaryRow label="Homepage" value={props.homepage} />
        )}
        <SummaryRow
          label="Client type"
          value={
            props.clientType === "confidential"
              ? "Confidential (with client_secret)"
              : "Public (PKCE, no secret)"
          }
        />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Redirect URIs
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {props.redirectUris.map((u) => (
              <li key={u} className="break-all">
                <code className="text-xs">{u}</code>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Scopes
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {props.scopes.map((s) => (
              <Badge
                key={s}
                variant={SCOPE_DESCRIPTIONS[s].badgeVariant}
                className="text-[10px]"
              >
                {s}
              </Badge>
            ))}
          </div>
          {props.hasWriteScope && (
            <p className="mt-2 flex items-start gap-2 text-xs text-warning">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              Includes write-capable scopes.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm">{value}</p>
    </div>
  );
}

// ─── Step 5: Credentials ───────────────────────────────────────────────

function CredentialsStep({
  app,
  scopes,
}: {
  app: NewlyRegisteredApp;
  scopes: OAuthCapabilityScope[];
}) {
  const firstRedirect = app.client.redirect_uris[0] ?? "";
  const scopeParam = scopes.join(" ");
  const authorizeUrl = useMemo(() => {
    const base =
      typeof window !== "undefined" ? window.location.origin : "";
    const u = new URL("/oauth/authorize", base || "http://localhost");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", app.client.client_id);
    u.searchParams.set("redirect_uri", firstRedirect);
    u.searchParams.set("scope", scopeParam);
    u.searchParams.set("state", "<random-state>");
    u.searchParams.set("code_challenge", "<S256(code_verifier)>");
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  }, [app.client.client_id, firstRedirect, scopeParam]);

  return (
    <Card>
      <CardContent className="space-y-5 px-6 py-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Credentials for {app.client.name}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Shown once. Store them securely before leaving this page.
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            client_id
          </p>
          <CopyBlock value={app.client.client_id} />
        </div>

        {app.client_secret && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              client_secret
            </p>
            <CopyBlock value={app.client_secret} />
            <p className="mt-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>
                Save this now. This is the only time it will be shown. If you
                lose it you&apos;ll have to rotate the secret and update every
                consumer.
              </span>
            </p>
          </div>
        )}

        <Separator />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sample authorize URL
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Point the user&apos;s browser here to start the flow. Replace the
            PKCE placeholder with a real S256(code_verifier) per RFC 7636.
          </p>
          <CopyBlock value={authorizeUrl} />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Step 6: Done ──────────────────────────────────────────────────────

function DoneStep() {
  return (
    <Card>
      <CardContent className="space-y-4 px-6 py-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            You&apos;re all set
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your OAuth client is live. Next steps:
          </p>
        </div>
        <ul className="flex flex-col gap-2 text-sm list-none">
          <li>
            <Link
              href="/app/settings/oauth_clients"
              className="inline-flex items-center gap-1 text-foreground underline underline-offset-2 hover:text-primary"
            >
              Back to OAuth clients
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <span className="ml-2 text-xs text-muted-foreground">
              Manage, rotate, or deprecate this client.
            </span>
          </li>
          <li>
            <Link
              href="/app/settings/connected_apps"
              className="inline-flex items-center gap-1 text-foreground underline underline-offset-2 hover:text-primary"
            >
              Connected Apps
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <span className="ml-2 text-xs text-muted-foreground">
              View live grants once a user completes the OAuth flow.
            </span>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API not available — ignore
    }
  }
  return (
    <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
      <code className="flex-1 break-all text-xs font-mono">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={copy}
        aria-label="Copy to clipboard"
        className="shrink-0 h-7 w-7 p-0"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      {copied && <span className="text-[11px] text-success">Copied</span>}
    </div>
  );
}
