"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction } from "@/app/app/settings/workspace/members/actions";
import { declineInvitationClientAction } from "./decline_action";

/**
 * Accept / decline buttons for the invitation page.
 *
 * Accept requires authentication — if the user is not signed in,
 * the server action will redirect to /sign_in. Decline does not
 * require authentication (it just marks the invitation as declined).
 */
export function InviteActions({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  function accept() {
    startTransition(async () => {
      const res = await acceptInvitationAction(token);
      if (res.ok) {
        router.push("/app");
      } else {
        setError(res.error);
      }
    });
  }

  function decline() {
    startTransition(async () => {
      const res = await declineInvitationClientAction(token);
      if (res.ok) {
        setDeclined(true);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  }

  if (declined) {
    return (
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          Invitation declined. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-xs text-destructive text-center" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={decline}
          disabled={pending}
        >
          {pending ? "Processing..." : "Decline"}
        </Button>
        <Button
          className="flex-1"
          onClick={accept}
          disabled={pending}
        >
          {pending ? "Processing..." : "Accept invitation"}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground text-center">
        You need to be signed in to accept the invitation.
      </p>
    </div>
  );
}
