"use client";

import { useState } from "react";
import { Key, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startRegistration } from "@simplewebauthn/browser";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PasskeyInfo {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

// ─── Date helper ─────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PasskeysManager({
  initialCredentials,
}: {
  initialCredentials: PasskeyInfo[];
}) {
  const [credentials, setCredentials] =
    useState<PasskeyInfo[]>(initialCredentials);
  const [registering, setRegistering] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleRegister() {
    setError(null);
    setRegistering(true);

    try {
      // 1. Get registration options from the server.
      const optionsRes = await fetch(
        "/api/auth/webauthn/register/options",
        { method: "POST" },
      );
      if (!optionsRes.ok) {
        throw new Error("Failed to get registration options");
      }
      const options = await optionsRes.json();

      // 2. Start the browser WebAuthn ceremony.
      const credential = await startRegistration({ optionsJSON: options });

      // 3. Send the response to the server for verification.
      const verifyRes = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: credential,
          deviceName: deviceName.trim() || undefined,
        }),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error ?? "Registration failed");
      }

      const result = await verifyRes.json();

      // 4. Add the new credential to the list.
      setCredentials((prev) => [
        {
          id: result.credentialRowId,
          deviceName: deviceName.trim() || null,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        },
        ...prev,
      ]);
      setDeviceName("");
      setShowNameInput(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Registration failed";
      // Don't show error if user cancelled the browser prompt.
      if (!message.includes("cancelled") && !message.includes("canceled") && !message.includes("AbortError")) {
        setError(message);
      }
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    setDeletingId(id);

    try {
      const res = await fetch("/api/auth/webauthn/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to remove passkey");
      }

      setCredentials((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove passkey",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Error banner */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Credential list */}
      {credentials.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
          <Key className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            No passkeys registered yet.
          </p>
          <p className="text-xs text-muted-foreground/70">
            Add a passkey to enable passwordless sign-in.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {credentials.map((cred) => (
            <li
              key={cred.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Key className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-col min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {cred.deviceName || "Unnamed passkey"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Added {formatDate(cred.createdAt)}
                    {cred.lastUsedAt && (
                      <> &middot; Last used {formatDate(cred.lastUsedAt)}</>
                    )}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                disabled={deletingId === cred.id}
                onClick={() => handleDelete(cred.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">Remove</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Register new passkey */}
      {showNameInput ? (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="passkey-name"
            className="text-sm font-medium text-foreground"
          >
            Passkey name (optional)
          </label>
          <div className="flex gap-2">
            <Input
              id="passkey-name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder='e.g. "MacBook Pro", "YubiKey 5C"'
              className="h-9 flex-1"
              disabled={registering}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleRegister();
                }
              }}
            />
            <Button
              size="sm"
              disabled={registering}
              onClick={handleRegister}
            >
              {registering ? "Registering..." : "Continue"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={registering}
              onClick={() => {
                setShowNameInput(false);
                setDeviceName("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setShowNameInput(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Register new passkey
        </Button>
      )}
    </div>
  );
}
