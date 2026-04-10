"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false);
  const [value, setValue] = useState("");

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
              disabled={value !== "DELETE"}
              onClick={() => {
                // Deletion not yet implemented — show browser alert as placeholder
                alert("Account deletion is coming soon. Please contact support to delete your account.");
                handleCancel();
              }}
            >
              Confirm deletion
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
