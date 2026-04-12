"use client";

import { useMemo, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { approveAuthorizeAction, denyAuthorizeAction } from "./actions";

/**
 * Consent form.
 *
 * On top of the capability-scope + workspace choices, users can pick
 * which boxes the connector is allowed to touch. The resulting box
 * narrowing is serialized into the scope string as one
 * `context:box:<uuid>` entry per selected box — the server action
 * re-validates and writes them to the authorization_code row.
 *
 * The form submits via server actions so the raw authorization code
 * never lives in client JS.
 */
export function AuthorizeConsentForm({
  clientId,
  redirectUri,
  state,
  codeChallenge,
  capabilityScopes,
  boxes,
  defaultBoxIds,
  connectorRequestedBoxIds,
  workspaces,
  activeWorkspaceId,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  capabilityScopes: string[];
  boxes: Array<{ id: string; name: string }>;
  /** Pre-selected on load. */
  defaultBoxIds: string[];
  /**
   * If the connector explicitly asked for a set of boxes in the scope
   * string, that set is authoritative — the user can only narrow it,
   * never broaden. Null means the connector asked for workspace-wide
   * and the user is free to narrow (or leave it broad).
   */
  connectorRequestedBoxIds: string[] | null;
  workspaces: Array<{ id: string; name: string; role: "owner" | "admin" | "member" | "viewer" }>;
  activeWorkspaceId: string;
}) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(activeWorkspaceId);
  const [selectedBoxIds, setSelectedBoxIds] = useState<Set<string>>(
    () => new Set(defaultBoxIds)
  );
  const [pending, startTransition] = useTransition();

  // Boxes the user can pick from. If the connector explicitly listed
  // ids, the user can only further narrow that set.
  const pickableBoxes = useMemo(() => {
    if (!connectorRequestedBoxIds) return boxes;
    const allowed = new Set(connectorRequestedBoxIds);
    return boxes.filter((b) => allowed.has(b.id));
  }, [boxes, connectorRequestedBoxIds]);

  const narrowToSpecificBoxes = selectedBoxIds.size !== boxes.length || !!connectorRequestedBoxIds;

  const finalScope = useMemo(() => {
    const parts = [...capabilityScopes];
    if (narrowToSpecificBoxes) {
      for (const id of selectedBoxIds) parts.push(`context:box:${id}`);
    }
    return parts.join(" ");
  }, [capabilityScopes, selectedBoxIds, narrowToSpecificBoxes]);

  function toggleBox(id: string) {
    setSelectedBoxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const nothingPicked = narrowToSpecificBoxes && selectedBoxIds.size === 0;

  return (
    <form className="flex flex-col gap-3">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="redirect_uri" value={redirectUri} />
      <input type="hidden" name="state" value={state} />
      <input type="hidden" name="code_challenge" value={codeChallenge} />
      <input type="hidden" name="scope" value={finalScope} />
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

      {pickableBoxes.length > 0 && (
        <fieldset className="rounded-md border border-border bg-background px-3 py-2">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Boxes this connector can access
          </legend>
          {connectorRequestedBoxIds && (
            <p className="mt-1 text-xs text-muted-foreground">
              This connector asked for access to{" "}
              {connectorRequestedBoxIds.length} specific box
              {connectorRequestedBoxIds.length === 1 ? "" : "es"}. You can
              only narrow the grant, not broaden it.
            </p>
          )}
          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-auto list-none">
            {pickableBoxes.map((b) => (
              <li key={b.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedBoxIds.has(b.id)}
                    onChange={() => toggleBox(b.id)}
                    disabled={pending}
                  />
                  <span>{b.name}</span>
                </label>
              </li>
            ))}
          </ul>
          {!connectorRequestedBoxIds && (
            <p className="mt-2 text-xs text-muted-foreground">
              Unchecking every box grants workspace-wide access. Pick a
              subset to restrict the connector to just those boxes.
            </p>
          )}
        </fieldset>
      )}

      {nothingPicked && (
        <p className="text-xs text-destructive" role="alert">
          Pick at least one box or restore workspace-wide access by
          rechecking all boxes.
        </p>
      )}

      <div className={cn("flex gap-2", pending && "opacity-60 pointer-events-none")}>
        <Button
          type="submit"
          className="flex-1"
          formAction={(fd) => startTransition(() => approveAuthorizeAction(fd))}
          disabled={pending || nothingPicked}
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
