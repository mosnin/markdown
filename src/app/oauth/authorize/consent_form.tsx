"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { approveAuthorizeAction, denyAuthorizeAction } from "./actions";

/**
 * Consent form. Submits via server actions — the server action is the
 * one that actually issues the authorization code so the raw code
 * never lives in client JS.
 */
export function AuthorizeConsentForm({
  clientId,
  redirectUri,
  state,
  codeChallenge,
  scope,
  workspaces,
  activeWorkspaceId,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  workspaces: Array<{ id: string; name: string; role: "owner" | "admin" | "member" | "viewer" }>;
  activeWorkspaceId: string;
}) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(activeWorkspaceId);
  const [pending, startTransition] = useTransition();

  return (
    <form className="flex flex-col gap-3">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="redirect_uri" value={redirectUri} />
      <input type="hidden" name="state" value={state} />
      <input type="hidden" name="code_challenge" value={codeChallenge} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="workspace_id" value={selectedWorkspaceId} />

      {workspaces.length > 1 && (
        <div>
          <label
            htmlFor="workspace-select"
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Authorize for workspace
          </label>
          <select
            id="workspace-select"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={selectedWorkspaceId}
            onChange={(e) => setSelectedWorkspaceId(e.target.value)}
            disabled={pending}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.role})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={cn("flex gap-2", pending && "opacity-60 pointer-events-none")}>
        <Button
          type="submit"
          className="flex-1"
          formAction={(fd) => startTransition(() => approveAuthorizeAction(fd))}
          disabled={pending}
        >
          {pending ? "Authorizing…" : "Approve"}
        </Button>
        <Button
          type="submit"
          variant="outline"
          className="flex-1"
          formAction={(fd) => startTransition(() => denyAuthorizeAction(fd))}
          disabled={pending}
        >
          Deny
        </Button>
      </div>
    </form>
  );
}
