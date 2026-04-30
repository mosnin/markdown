"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, LayoutGrid, Plus, Settings } from "lucide-react";
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
  const initial = (activeName.trim().charAt(0) || "W").toUpperCase();
  const hasActive = Boolean(active);

  // Hold every post-menu-close defer timer in a ref so unmount (or a
  // rapid second click) can clear the pending timeout. Without this the
  // setTimeout callbacks would fire on a torn-down component.
  const deferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (deferTimerRef.current) {
        clearTimeout(deferTimerRef.current);
        deferTimerRef.current = null;
      }
    };
  }, []);

  function deferAfterMenuClose(cb: () => void) {
    if (deferTimerRef.current) clearTimeout(deferTimerRef.current);
    deferTimerRef.current = setTimeout(() => {
      deferTimerRef.current = null;
      cb();
    }, 0);
  }

  function selectWorkspace(id: string) {
    if (id === activeWorkspaceId) return;
    // Defer the server action one tick so Base UI's Menu close animation
    // and focus return complete first. Without this, the menu close can
    // cancel the router navigation on some browsers.
    deferAfterMenuClose(() => {
      startSwitching(async () => {
        const result = await setActiveWorkspaceAction(id);
        if (result.ok) {
          router.push("/app");
          router.refresh();
        } else {
          console.error("Workspace switch failed:", result.error);
        }
      });
    });
  }

  function openCreateDialog() {
    // Open the dialog after the menu's close animation + focus return
    // completes. Running setCreateOpen(true) synchronously inside a
    // DropdownMenuItem onClick causes the Base UI Dialog focus trap to
    // collide with the Menu's own focus management, which prevents the
    // dialog from appearing. The microtask defer lets the menu finish
    // closing before the dialog takes over.
    deferAfterMenuClose(() => setCreateOpen(true));
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
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
            "hover:bg-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            "aria-expanded:bg-accent",
            switching && "opacity-60",
          )}
          aria-label={`Workspace: ${activeName}. Click to switch.`}
        >
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
              "text-[11px] font-semibold tracking-tight",
              hasActive
                ? "border border-[oklch(0.78_0.18_88)] bg-brand text-brand-foreground"
                : "border border-border bg-muted text-foreground",
            )}
            aria-hidden="true"
          >
            {initial}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-foreground">
            {activeName}
          </span>
          <ChevronsUpDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
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
            onClick={() => deferAfterMenuClose(() => router.push("/app/workspaces"))}
            className="flex items-center gap-2"
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            Manage workspaces
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => deferAfterMenuClose(() => router.push("/app/settings"))}
            className="flex items-center gap-2"
          >
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
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
