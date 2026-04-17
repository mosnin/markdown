import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { Separator } from "@/components/ui/separator";
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
      <div className="bg-background px-6 pt-6 pb-4">
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            href="/app/settings/oauth_clients"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to OAuth clients
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Register OAuth client
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Guided setup for a new OAuth 2.1 client. You&apos;ll see the
          credentials once at the end — store them somewhere safe.
        </p>
      </div>
      <Separator />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <OauthClientWizard />
        </div>
      </div>
    </div>
  );
}
