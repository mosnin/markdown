import Link from "next/link";
import { ArrowLeft, Building2, CheckCircle2, ExternalLink, Lock } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { canAdmin } from "@/server/auth/require_role";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/product/page_header";

/**
 * Enterprise SSO surface.
 *
 * The implementation lives behind a sales conversation today — provisioning
 * IdP metadata, mapping group claims to workspace roles, and stamping the
 * domain-claim verification record require touching the supabase auth
 * config and our cluster's redirect-URI allow-list. We surface the page
 * (admin-only, gated by `canAdmin`) so customers can find what's available,
 * see what's coming, and start the conversation in-product without having
 * to chase a salesperson cold. When provisioning ships, this page becomes
 * the configure-and-test surface; the layout and IA are already correct.
 */
export const metadata = {
  title: "Enterprise SSO — Settings — Poggle",
};

const PROVIDERS = [
  {
    name: "Okta",
    body: "SAML 2.0 + SCIM 2.0. Group-claim → workspace-role mapping supported.",
    tier: "Enterprise",
  },
  {
    name: "Azure AD / Entra ID",
    body: "SAML 2.0 + OIDC. Conditional-access policies pass through unchanged.",
    tier: "Enterprise",
  },
  {
    name: "Google Workspace",
    body: "SAML 2.0. Domain-locked sign-in so only your verified domain enrolls.",
    tier: "Enterprise",
  },
  {
    name: "Generic SAML 2.0",
    body: "Bring your own IdP. We accept standards-compliant SAML metadata.",
    tier: "Enterprise",
  },
  {
    name: "OpenID Connect (OIDC)",
    body: "OIDC with PKCE for IdPs that prefer it over SAML.",
    tier: "Enterprise",
  },
  {
    name: "SCIM 2.0 user lifecycle",
    body: "Just-in-time provisioning, deprovisioning, and group sync.",
    tier: "Enterprise",
  },
];

const FEATURES = [
  "Domain-claim verification (no rogue tenants on your domain)",
  "Group-claim → workspace-role mapping (admin / member / viewer)",
  "Mandatory MFA enforced at the IdP, not duplicated in-app",
  "Just-in-time user provisioning + automatic deprovisioning",
  "Audit-log entry for every IdP-driven login and role change",
  "Quarterly access reviews exported as CSV",
];

export default async function EnterpriseSsoSettingsPage() {
  const ctx = await requireAuthenticatedUser();
  const isAdmin = canAdmin(ctx.workspace.role);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Enterprise SSO"
        description="Single sign-on, SCIM provisioning, and group-based role mapping for organizations that need IT-owned identity."
        actions={
          <Link
            href="/app/settings"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back
          </Link>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          {/* Status card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <CardTitle>Status</CardTitle>
                </div>
                <Badge variant="brand-subtle">Enterprise tier</Badge>
              </div>
              <CardDescription className="mt-2">
                {isAdmin
                  ? "Available on the Enterprise tier. Configuration is sales-assisted today — provisioning typically completes inside one business day."
                  : "Visible to admins. Talk to your workspace admin if you'd like to enable SSO for your team."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="default"
                  render={<Link href="mailto:sales@poggle.app?subject=Enterprise%20SSO" />}
                  disabled={!isAdmin}
                >
                  <Building2 className="size-4" data-icon="inline-start" />
                  Talk to sales
                </Button>
                <Button
                  variant="outline"
                  render={<Link href="/trust" />}
                >
                  Trust & security overview
                  <ExternalLink className="size-3.5" data-icon="inline-end" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Supported providers */}
          <Card>
            <CardHeader>
              <CardTitle>Supported identity providers</CardTitle>
              <CardDescription>
                Standards-compliant SAML 2.0 / OIDC + SCIM 2.0. If your IdP
                isn't listed, it almost certainly works — get in touch.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent>
              <ul className="divide-y divide-border list-none">
                {PROVIDERS.map((p) => (
                  <li
                    key={p.name}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {p.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.body}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="shrink-0 text-[11px] font-normal"
                    >
                      {p.tier}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* What ships with SSO */}
          <Card>
            <CardHeader>
              <CardTitle>What's included</CardTitle>
              <CardDescription>
                Every Enterprise SSO deployment ships with the full identity
                lifecycle, not just the login button.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent>
              <ul className="list-none space-y-2.5">
                {FEATURES.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"
                  >
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand"
                      aria-hidden="true"
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
