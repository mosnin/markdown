"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAbsoluteDate } from "@/lib/format_date";
import {
  createOperatorApiKeyAction,
  revokeOperatorApiKeyAction,
} from "@/app/app/workspace_operator/api_keys_actions";
import type {
  OperatorApiKeyPublic,
  CreatedApiKey,
} from "@/server/services/operator_api_keys_service";

/**
 * Operator REST API keys manager — list + generate + revoke.
 *
 * Generation is a two-step dialog: name → confirm. The raw key is shown
 * exactly once after creation; the user must copy it then. Closing the
 * dialog scrubs the raw key from local state.
 */

export interface OperatorApiKeysManagerProps {
  initialKeys: OperatorApiKeyPublic[];
}

export function OperatorApiKeysManager({
  initialKeys,
}: OperatorApiKeysManagerProps) {
  const [keys, setKeys] = useState<OperatorApiKeyPublic[]>(initialKeys);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [error, setError] = useState<string>("");
  const [pending, startTransition] = useTransition();

  function handleCreate(name: string) {
    setError("");
    startTransition(async () => {
      const res = await createOperatorApiKeyAction({ name });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Splice a public-shape row into the list (we don't have the
      // full row from the action — just the bits the UI displays).
      setKeys((current) => [
        {
          id: res.data.id,
          workspace_id: res.data.workspaceId,
          name: res.data.name,
          key_prefix: res.data.prefix,
          created_at: res.data.createdAt,
          last_used_at: null,
          revoked_at: null,
        },
        ...current,
      ]);
      setCreating(false);
      setCreatedKey(res.data);
    });
  }

  function handleRevoke(id: string) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Revoke this API key? Any script using it will start getting 401s immediately."
      )
    ) {
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await revokeOperatorApiKeyAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setKeys((current) =>
        current.map((row) =>
          row.id === id
            ? { ...row, revoked_at: new Date().toISOString() }
            : row
        )
      );
    });
  }

  return (
    <Card id="operator-api-keys">
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Bearer tokens for the Workspace Operator REST API. Each key is
          scoped to one workspace and tied to your user.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {keys.length} key{keys.length === 1 ? "" : "s"} (revoked keys
            stay listed for audit purposes).
          </p>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              setError("");
              setCreating(true);
            }}
          >
            Generate new key
          </Button>
        </div>

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        {keys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            No API keys yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Prefix</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-left">Last used</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2 align-top text-foreground">
                      {row.name}
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-muted-foreground">
                      {row.key_prefix}…
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground whitespace-nowrap">
                      {formatAbsoluteDate(row.created_at)}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground whitespace-nowrap">
                      {row.last_used_at
                        ? formatAbsoluteDate(row.last_used_at)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {row.revoked_at ? (
                        <Badge variant="warning">revoked</Badge>
                      ) : (
                        <Badge variant="success">active</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      {row.revoked_at ? null : (
                        <Button
                          variant="destructive"
                          size="xs"
                          onClick={() => handleRevoke(row.id)}
                          disabled={pending}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <CreateKeyDialog
        open={creating}
        pending={pending}
        onCancel={() => setCreating(false)}
        onCreate={handleCreate}
      />

      <ShowRawKeyDialog
        created={createdKey}
        onClose={() => setCreatedKey(null)}
      />
    </Card>
  );
}

function CreateKeyDialog({
  open,
  pending,
  onCancel,
  onCreate,
}: {
  open: boolean;
  pending: boolean;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName("");
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate API key</DialogTitle>
          <DialogDescription>
            Give the key a memorable name. You'll see the raw token once
            after creation — copy it then.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed || pending) return;
            onCreate(trimmed);
            setName("");
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-foreground">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="e.g. CI dispatcher"
              autoFocus
            />
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setName("");
                onCancel();
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={pending || name.trim().length === 0}
            >
              {pending ? "Generating..." : "Generate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShowRawKeyDialog({
  created,
  onClose,
}: {
  created: CreatedApiKey | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open={created !== null}
      onOpenChange={(next) => {
        if (!next) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy your new API key</DialogTitle>
          <DialogDescription>
            This is the only time the raw token will be shown. Store it in
            a secret manager now — there's no recovery path.
          </DialogDescription>
        </DialogHeader>
        {created && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs break-all text-foreground">
              {created.rawKey}
            </div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                if (typeof navigator !== "undefined") {
                  void navigator.clipboard
                    ?.writeText(created.rawKey)
                    .then(() => setCopied(true));
                }
              }}
            >
              {copied ? "Copied" : "Copy to clipboard"}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            I've saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
