"use client";

import { useState, useTransition, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { suspendUserAction, unsuspendUserAction } from "./actions";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  workspace_name: string | null;
  workspace_slug: string | null;
  plan: "free" | "pro";
  banned_until: string | null;
  created_at: string;
}

interface UserTableProps {
  users: UserRow[];
  page: number;
  totalPages: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isSuspended(bannedUntil: string | null): boolean {
  if (!bannedUntil || bannedUntil === "none") return false;
  const banDate = new Date(bannedUntil);
  return banDate > new Date();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ suspended }: { suspended: boolean }) {
  if (suspended) {
    return (
      <Badge variant="destructive" className="text-xs">
        Suspended
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="text-xs">
      Active
    </Badge>
  );
}

// ─── Suspend / Unsuspend confirm dialog ───────────────────────────────────────

function SuspendToggleButton({
  user,
  suspended,
  onFeedback,
}: {
  user: UserRow;
  suspended: boolean;
  onFeedback: (msg: string, isError: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = suspended
        ? await unsuspendUserAction(user.id)
        : await suspendUserAction(user.id);

      setOpen(false);

      if (result.ok) {
        onFeedback(
          `${user.email} has been ${suspended ? "unsuspended" : "suspended"}.`,
          false
        );
      } else {
        onFeedback(
          result.error ?? `Failed to ${suspended ? "unsuspend" : "suspend"} user.`,
          true
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={suspended ? "outline" : "destructive"}
            size="sm"
            className="text-xs"
          />
        }
      >
        {suspended ? "Unsuspend" : "Suspend"}
      </DialogTrigger>

      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {suspended ? "Unsuspend user?" : "Suspend user?"}
          </DialogTitle>
          <DialogDescription>
            {suspended ? (
              <>
                This will restore access for{" "}
                <strong className="text-foreground font-medium">
                  {user.email}
                </strong>
                . They will be able to sign in immediately.
              </>
            ) : (
              <>
                This will block{" "}
                <strong className="text-foreground font-medium">
                  {user.email}
                </strong>{" "}
                from signing in. The ban lasts 10 years (effectively
                permanent until manually lifted).
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            variant={suspended ? "default" : "destructive"}
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending
              ? suspended
                ? "Unsuspending…"
                : "Suspending…"
              : suspended
              ? "Yes, unsuspend"
              : "Yes, suspend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="text-xs"
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="text-xs"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// ─── Main table component ─────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export function UserTable({ users }: UserTableProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  function handleFeedback(message: string, isError: boolean) {
    setFeedback({ message, isError });
    // Auto-dismiss after 4 s
    setTimeout(() => setFeedback(null), 4000);
  }

  // Client-side search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.workspace_name ?? "").toLowerCase().includes(q)
    );
  }, [users, search]);

  // Client-side pagination over filtered results
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const paginated = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <div className="flex items-center gap-3">
        <Input
          type="search"
          placeholder="Search by email or workspace…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="max-w-sm"
        />
        {search && (
          <span className="text-xs text-muted-foreground">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-lg border px-4 py-2.5 text-sm ${
            feedback.isError
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-green-200 bg-green-50 text-green-800 dark:border-green-800/30 dark:bg-green-900/20 dark:text-green-400"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Workspace
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Plan
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Joined
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    {search ? "No users match your search." : "No users found."}
                  </td>
                </tr>
              ) : (
                paginated.map((user) => {
                  const suspended = isSuspended(user.banned_until);
                  return (
                    <tr
                      key={user.id}
                      className={`transition-colors hover:bg-muted/30 ${
                        suspended ? "opacity-60" : ""
                      }`}
                    >
                      {/* Email — strikethrough when suspended */}
                      <td className="px-4 py-3">
                        <span
                          className={`font-mono text-xs ${
                            suspended
                              ? "line-through text-muted-foreground"
                              : "text-foreground"
                          }`}
                        >
                          {user.email}
                        </span>
                      </td>

                      {/* Workspace */}
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {user.workspace_name ? (
                          <span title={user.workspace_slug ?? undefined}>
                            {user.workspace_name}
                          </span>
                        ) : (
                          <span className="italic text-muted-foreground/60">
                            None
                          </span>
                        )}
                      </td>

                      {/* Plan */}
                      <td className="px-4 py-3">
                        <Badge
                          variant={user.plan === "pro" ? "default" : "outline"}
                          className="text-xs capitalize"
                        >
                          {user.plan}
                        </Badge>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge suspended={suspended} />
                      </td>

                      {/* Joined */}
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                        {formatDate(user.created_at)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <SuspendToggleButton
                          user={user}
                          suspended={suspended}
                          onFeedback={handleFeedback}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </div>

      {/* Summary line */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} user{filtered.length !== 1 ? "s" : ""} total
        {search ? ` matching "${search}"` : ""}
      </p>
    </div>
  );
}
