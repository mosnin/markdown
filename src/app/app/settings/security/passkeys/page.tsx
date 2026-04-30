import { Fingerprint } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createAdminClient } from "@/lib/supabase/admin";
import { listCredentials } from "@/server/services/webauthn_service";
import { PageHeader } from "@/components/product/page_header";
import { PasskeysManager } from "./passkeys_client";

export const metadata = {
  title: "Passkeys — Settings — Poggle",
};

export default async function PasskeysPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = createAdminClient();
  const credentials = await listCredentials(supabase, ctx.user.id);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Passkeys"
        description="Manage passkeys for passwordless sign-in."
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-6 px-6 py-6">
          <Card>
            <CardHeader className="px-6 pt-6 pb-4">
              <div className="flex items-center gap-2">
                <Fingerprint className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base font-semibold">
                  Registered passkeys
                </CardTitle>
              </div>
              <CardDescription className="text-sm text-muted-foreground">
                Passkeys let you sign in without a password using your
                device&apos;s biometric sensor, security key, or screen lock.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="px-6 pt-5 pb-6">
              <PasskeysManager
                initialCredentials={credentials.map((c) => ({
                  id: c.id,
                  deviceName: c.device_name,
                  createdAt: c.created_at,
                  lastUsedAt: c.last_used_at,
                }))}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
