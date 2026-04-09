import Link from "next/link";
import { Archive, Box, MoreHorizontal, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/product/empty_state";
import { PageHeader } from "@/components/product/page_header";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── Stub data ───────────────────────────────────────────────────────────────

const stubWorkspaces = [
  {
    id: "ws-1",
    name: "Personal",
    description: "Personal knowledge base, reading notes, and guides.",
    boxCount: 3,
    noteCount: 12,
    updatedAt: "Today",
  },
];

// ─── Workspace card ──────────────────────────────────────────────────────────

function WorkspaceCard({
  name,
  description,
  boxCount,
  noteCount,
  updatedAt,
}: (typeof stubWorkspaces)[number]) {
  return (
    <Card className="transition-standard hover:shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">{name}</CardTitle>
          </div>
          <DropdownMenu>
            {/* Base UI: use render prop instead of asChild */}
            <DropdownMenuTrigger
              render={
                <button
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon" }),
                    "h-7 w-7 text-muted-foreground"
                  )}
                />
              }
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Rename</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive">
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CardDescription className="text-sm">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Box className="h-3 w-3" />
            <span>
              {boxCount} {boxCount === 1 ? "box" : "boxes"}
            </span>
          </div>
          <span>·</span>
          <span>{noteCount} notes</span>
          <span>·</span>
          <span>Updated {updatedAt}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WorkspacesPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Workspaces"
        description="Workspaces are the top-level organizational unit in Context Store."
        actions={
          <Button size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New workspace
          </Button>
        }
      />

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {stubWorkspaces.length === 0 ? (
            <EmptyState
              icon={<Archive className="h-5 w-5" />}
              title="No workspaces yet"
              description="Create your first workspace to start organizing context."
              action={
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  New workspace
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              {stubWorkspaces.map((ws) => (
                <WorkspaceCard key={ws.id} {...ws} />
              ))}
            </div>
          )}

          {/* Concept note */}
          <div className="mt-8 rounded-lg border border-border-subtle bg-muted/40 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">
              About workspaces
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Each workspace contains boxes. Boxes contain folders, notes,
              guides, and context bundles. Workspaces do not share content
              directly — use context bundles to reference across workspaces.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {["workspace", "box", "folder", "note", "guide", "bundle"].map(
                (term) => (
                  <Badge
                    key={term}
                    variant="outline"
                    className="text-[10px] font-normal"
                  >
                    {term}
                  </Badge>
                )
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
