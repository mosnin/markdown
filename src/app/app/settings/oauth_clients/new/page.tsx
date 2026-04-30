import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { PageHeader } from "@/components/product/page_header";
import { OauthClientWizard } from "./wizard";

/**
 * Guided OAuth client setup wizard.
 *
 * Walks a developer through registering a new confidential or public
 * OAuth client in six steps (basics → redirect URIs → scopes →
 * review → credentials → done). The multi-step flow replaces the
 * previous modal-based register dialog as the primary CTA; the modal
 * is preserved for users who land on it via deep links but the page
 * button now routes here.
 *
 * Server component wrapper: auth-gates the page and renders the
 * client-side wizard state machine. No data fetching is needed up
 * front — the wizard posts to the existing
 * `registerDeveloperAppAction` server action on submit.
 */
export default async function NewOauthClientPage() {
  await requireAuthenticatedUser();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Register OAuth client"
        description="Guided setup for a new OAuth 2.1 client. You'll see the credentials once at the end — store them somewhere safe."
        actions={
          <Link
            href="/app/settings/oauth_clients"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back
          </Link>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <OauthClientWizard />
        </div>
      </div>
    </div>
  );
}
