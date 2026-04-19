"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Bot,
  FileText,
  FolderPlus,
  Inbox,
  LayoutGrid,
  Package,
  Plus,
  Search,
  Settings,
  Sparkles,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

interface BoxRef {
  id: string;
  name: string;
}

interface GlobalSearchProps {
  /** Boxes in the active workspace — used for quick navigation. */
  boxes: BoxRef[];
  /** Callback to open the Workspace Operator panel. */
  onOpenOperator?: () => void;
}

/**
 * Global command palette — opens with ⌘K (or Ctrl+K).
 *
 * Provides quick navigation across the authenticated app: every primary
 * nav destination, every box the user owns, and quick-action entry
 * points (new box, go to search, settings, etc). Mounted once in the
 * app layout so the shortcut works on every page.
 *
 * The trigger button renders as a compact "Search" pill suitable for
 * the top bar. Clicking it (or pressing ⌘K) opens the palette.
 */
export function GlobalSearch({ boxes, onOpenOperator }: GlobalSearchProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  function go(path: string) {
    setOpen(false);
    router.push(path);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        className={cn(
          "inline-flex h-9 w-fit items-center rounded-full border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm shadow-black/5 transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20",
        )}
      >
        <span className="flex grow items-center">
          <Search
            className="-ms-1 me-3 h-4 w-4 text-muted-foreground/80"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="font-normal text-muted-foreground/70">
            Search or jump to…
          </span>
        </span>
        <kbd className="-me-1 ms-8 hidden h-5 max-h-full items-center rounded border border-border bg-background px-1 font-[inherit] text-[0.625rem] font-medium text-muted-foreground/70 sm:inline-flex">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or jump to a box…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>

          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => go("/app")}>
              <ArrowUpRight
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>Home</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/app/search")}>
              <Search
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>Full-text search</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/app/workspaces")}>
              <LayoutGrid
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>Workspaces</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/app/skills")}>
              <Zap
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>Skills</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/app/agents")}>
              <Bot
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>Agents</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/app/proposals")}>
              <Inbox
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>Proposals</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/app/audit")}>
              <FileText
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>Audit log</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/app/settings")}>
              <Settings
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>Settings</span>
            </CommandItem>
          </CommandGroup>

          {boxes.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Jump to box">
                {boxes.map((b) => (
                  <CommandItem
                    key={b.id}
                    value={`box ${b.name}`}
                    onSelect={() => go(`/app/boxes/${b.id}`)}
                  >
                    <Package
                      className="h-4 w-4 opacity-60"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                    <span>{b.name}</span>
                    <CommandShortcut>Box</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          <CommandSeparator />
          <CommandGroup heading="Quick actions">
            <CommandItem onSelect={() => go("/app/workspaces")}>
              <Plus
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>New box</span>
              <CommandShortcut>Go to workspaces</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/app/skills")}>
              <FolderPlus
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>New skill</span>
              <CommandShortcut>Go to skills</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/app/agents")}>
              <Bot
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>New agent</span>
              <CommandShortcut>Go to agents</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Workspace Operator">
            <CommandItem
              onSelect={() => {
                setOpen(false);
                onOpenOperator?.();
              }}
            >
              <Sparkles
                className="h-4 w-4 opacity-60"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>Run Workspace Operator</span>
              <CommandShortcut>AI</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
