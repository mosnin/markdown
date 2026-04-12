"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, LayoutGrid, Plus } from "lucide-react";
import { AccountSetting01Icon } from "hugeicons-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createWorkspaceAction,
  setActiveWorkspaceAction,
} from "@/app/app/workspaces/actions";

interface WorkspaceOption {
  id: string;
  name: string;
  slug: string;
}

interface WorkspaceSwitcherProps {
  /** All workspaces owned by the current user (in display order). */
  workspaces: WorkspaceOption[];
  /** The workspace currently selected for this request. */
  activeWorkspaceId: string;
}

/**
 * Workspace switcher pill — shown at the top of the sidebar.
 *
 * Clicking opens a dropdown listing every workspace the user owns,
 * highlighting the active one. Selecting a different workspace writes
 * the `active_workspace_id` cookie and refreshes the route tree so
 * every server component picks up the new workspace via
 * `getRequestContext()`.
 *
 * A "New workspace" action at the bottom opens a dialog that creates
 * a workspace and makes it active in one step.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const [switching, startSwitching] = useTransition();
  const [creating, startCreating] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const activeName = active?.name ?? "My Workspace";

  function selectWorkspace(id: string) {
    if (id === activeWorkspaceId) return;
    // Defer the server action one tick so Base UI's Menu close animation
    // and focus return complete first. Without this, the menu close can
    // cancel the router navigation on some browsers.
    setTimeout(() => {
      startSwitching(async () => {
        const result = await setActiveWorkspaceAction(id);
        if (result.ok) {
          router.push("/app");
          router.refresh();
        } else {
          console.error("Workspace switch failed:", result.error);
        }
      });
    }, 0);
  }

  function openCreateDialog() {
    // Open the dialog after the menu's close animation + focus return
    // completes. Running setCreateOpen(true) synchronously inside a
    // DropdownMenuItem onClick causes the Base UI Dialog focus trap to
    // collide with the Menu's own focus management, which prevents the
    // dialog from appearing. The microtask defer lets the menu finish
    // closing before the dialog takes over.
    setTimeout(() => setCreateOpen(true), 0);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    setError(null);
    startCreating(async () => {
      const result = await createWorkspaceAction(trimmed);
      if (result.ok) {
        setCreateOpen(false);
        setNewName("");
        router.push("/app");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 transition-fast",
            "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            switching && "opacity-60",
          )}
          aria-label={`Workspace: ${activeName}. Click to switch.`}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center">
            <Image
              src="/logo-symbol-dark.png"
              alt="Poggle"
              width={24}
              height={24}
              className="rounded dark:hidden"
              priority
            />
            <Image
              src="/logo-symbol-light.png"
              alt="Poggle"
              width={24}
              height={24}
              className="rounded hidden dark:block"
              priority
            />
          </div>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-foreground text-left">
            {activeName}
          </span>
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-foreground/40"
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" className="min-w-56">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Your workspaces
          </DropdownMenuLabel>
          {workspaces.map((w) => {
            const isActive = w.id === activeWorkspaceId;
            return (
              <DropdownMenuItem
                key={w.id}
                onClick={() => selectWorkspace(w.id)}
                className={cn(
                  "flex items-center gap-2",
                  isActive && "bg-accent/40 font-medium text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {isActive && (
                  <Check
                    className="h-3.5 w-3.5 text-foreground/70"
                    aria-label="Active workspace"
                  />
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={openCreateDialog}
            className="flex items-center gap-2 text-foreground"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New workspace
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/*
            Use onClick + router.push instead of Base UI's `render={<Link>}`
            pattern. Cloning a next/link element through the Menu.Item
            render prop caused the dropdown to error on open because Link's
            internals expect to own the element tree and don't play nicely
            with Base UI's ref / children forwarding. The rest of the app
            uses this same onClick pattern — see user_menu.tsx, tree_sidebar.
          */}
          <DropdownMenuItem
            onClick={() => setTimeout(() => router.push("/app/workspaces"), 0)}
            className="flex items-center gap-2"
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            Manage workspaces
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setTimeout(() => router.push("/app/settings"), 0)}
            className="flex items-center gap-2"
          >
            <AccountSetting01Icon className="h-3.5 w-3.5" aria-hidden="true" />
            Workspace settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v) {
            setNewName("");
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <Input
              placeholder="e.g. Personal, Work, Open source"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              required
              disabled={creating}
            />
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              A new workspace is a fresh container for boxes, notes, files,
              skills, and agents. It does not share content with your other
              workspaces.
            </p>
            <DialogFooter showCloseButton>
              <Button
                type="submit"
                size="sm"
                disabled={creating || !newName.trim()}
              >
                {creating ? "Creating…" : "Create workspace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
