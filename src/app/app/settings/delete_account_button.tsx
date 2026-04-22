"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteAccountAction } from "./delete_account_actions";

export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false);
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    setConfirming(false);
    setValue("");
  }

  return (
    <>
      {!confirming ? (
        <Button
          variant="destructive"
          size="sm"
          className="shrink-0"
          onClick={() => setConfirming(true)}
        >
          Delete account
        </Button>
      ) : (
        <div className="flex flex-col gap-3 w-full">
          <p className="text-sm text-destructive font-medium">
            Are you sure? This cannot be undone.
          </p>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="delete-confirm-input"
              className="text-xs text-muted-foreground"
            >
              Type <span className="font-mono font-semibold text-foreground">DELETE</span> to confirm
            </label>
            <Input
              id="delete-confirm-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="DELETE"
              className="max-w-xs font-mono"
              autoFocus
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={isPending || value !== "DELETE"}
              onClick={() => {
                startTransition(async () => {
                  const result = await deleteAccountAction();
                  if (result && !result.ok) {
                    setError(result.error);
                  }
                  // On success, the server action calls redirect("/") so we never reach here
                });
              }}
            >
              {isPending ? "Deleting…" : "Confirm deletion"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </>
  );
}
