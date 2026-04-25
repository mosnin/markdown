"use client";

import Link from "next/link";
import {
  Archive,
  Calendar,
  ChevronRight,
  Clock,
  GitBranch,
  Tag,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileLanguageBadge } from "@/components/product/files/file_language_badge";
import {
  FileObjectLinksPanel,
  type ResolvedObjectLink,
  type LinkTarget,
} from "@/components/product/files/file_object_links_panel";
import { type File as FileObject } from "@/server/domain/types/file";
import { type ObjectVersion } from "@/server/domain/types/object_version";
import { type SourceFormat } from "@/server/domain/constants/object_constants";
import { getFormatInfo } from "@/lib/file_format_utils";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(dateStr);
}

// ─── Info sub-components ──────────────────────────────────────────────────────

function InfoSection({
  children,
  border = true,
}: {
  children: React.ReactNode;
  border?: boolean;
}) {
  return (
    <div className={cn("px-4 py-3", border && "border-b border-border")}>
      {children}
    </div>
  );
}

function InfoLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
      {children}
    </p>
  );
}

// ─── Version history item ─────────────────────────────────────────────────────

function VersionItem({
  version,
  isCurrent,
}: {
  version: ObjectVersion;
  isCurrent: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-xs",
        isCurrent && "bg-muted/40"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground/60">
          v{version.version_number}
        </span>
        {isCurrent && (
          <Badge variant="secondary" className="text-[9px] font-normal">
            current
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{formatRelativeDate(version.created_at)}</span>
      </div>
      {version.change_origin && version.change_origin !== "human_edit" && (
        <span className="text-[10px] text-muted-foreground/50 capitalize">
          {version.change_origin.replace(/_/g, " ")}
        </span>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

const VALID_TABS = ["info", "links", "history"] as const;
type FileContextTab = (typeof VALID_TABS)[number];

interface FileContextPanelProps {
  file: FileObject;
  boxId: string;
  boxName: string;
  folderName: string | null;
  workspaceName: string;
  outgoingLinks: ResolvedObjectLink[];
  incomingLinks: ResolvedObjectLink[];
  eligibleLinkTargets: LinkTarget[];
  versions: ObjectVersion[];
  defaultTab?: FileContextTab;
}

/**
 * Right-pane context panel for the Files workspace surface.
 *
 * Mirrors the NoteContextPanel pattern with three tabs:
 *   - Info: file metadata (name, format, size, status, location, dates)
 *   - Links: semantic object relationships (uses FileObjectLinksPanel)
 *   - History: immutable version list (uses object_versions)
 *
 * No bundle tab: files do not have a context bundle surface in this version.
 */
export function FileContextPanel({
  file,
  boxId,
  boxName,
  folderName,
  workspaceName,
  outgoingLinks,
  incomingLinks,
  eligibleLinkTargets,
  versions,
  defaultTab = "info",
}: FileContextPanelProps) {
  const formatInfo = getFormatInfo(file.canonical_format as SourceFormat);
  const ext = file.file_extension ?? formatInfo.extension;
  const linkCount = outgoingLinks.length + incomingLinks.length;

  const ORIGIN_LABEL: Record<string, string> = {
    user_created: "User created",
    imported: "Imported",
    generated: "Generated",
  };

  const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
    draft:    { label: "Draft",    className: "" },
    active:   { label: "Active",   className: "text-emerald-600 dark:text-emerald-400" },
    archived: { label: "Archived", className: "text-muted-foreground" },
    trashed:  { label: "Trashed",  className: "text-destructive" },
  };

  const statusCfg = STATUS_CONFIG[file.status] ?? STATUS_CONFIG.active;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Panel header */}
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          File context
        </p>
      </div>

      <Tabs defaultValue={defaultTab} className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-4">
          <TabsList variant="line" className="h-auto pb-0">
            <TabsTrigger value="info" className="pb-2.5 text-xs">
              Info
            </TabsTrigger>
            <TabsTrigger value="links" className="relative pb-2.5 text-xs">
              Links
              {linkCount > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1 text-[10px] text-muted-foreground">
                  {linkCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="pb-2.5 text-xs">
              History
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Info tab ── */}
        <TabsContent value="info" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            {/* Status banner for archived/trashed */}
            {(file.status === "archived" || file.status === "trashed") && (
              <div className="border-b border-border/60 bg-muted/20 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  {file.status === "archived" ? (
                    <Archive className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                  )}
                  <p className={cn("text-xs font-medium", statusCfg.className)}>
                    {statusCfg.label}
                  </p>
                </div>
              </div>
            )}

            {/* Identity */}
            <InfoSection>
              <p className="font-mono text-sm font-medium text-foreground break-all">
                {file.name}
              </p>
              {file.description && (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {file.description}
                </p>
              )}
            </InfoSection>

            {/* Format */}
            <InfoSection>
              <InfoLabel>Format</InfoLabel>
              <div className="flex items-center gap-2 flex-wrap">
                <FileLanguageBadge
                  format={file.canonical_format as SourceFormat}
                  extension={file.file_extension}
                />
                <span className="font-mono text-[10px] text-muted-foreground/60">
                  {ext}
                </span>
              </div>
              {file.mime_type && (
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/40">
                  {file.mime_type}
                </p>
              )}
            </InfoSection>

            {/* Size */}
            <InfoSection>
              <InfoLabel>Size</InfoLabel>
              <p className="text-xs text-foreground/70">
                {file.content_bytes < 1024
                  ? `${file.content_bytes} B`
                  : `${(file.content_bytes / 1024).toFixed(1)} KB`}
              </p>
            </InfoSection>

            {/* Tags */}
            {file.tags.length > 0 && (
              <InfoSection>
                <InfoLabel>Tags</InfoLabel>
                <div className="flex flex-wrap gap-1">
                  {file.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="flex items-center gap-0.5 text-xs font-normal">
                      <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              </InfoSection>
            )}

            {/* Summary */}
            {file.summary && (
              <InfoSection>
                <InfoLabel>Summary</InfoLabel>
                <p className="text-xs leading-relaxed text-foreground/80">
                  {file.summary}
                </p>
              </InfoSection>
            )}

            {/* Location */}
            <InfoSection>
              <InfoLabel>Location</InfoLabel>
              <nav
                aria-label="File location"
                className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
              >
                <Link
                  href="/app"
                  className="hover:text-foreground hover:underline underline-offset-2 transition-fast"
                >
                  {workspaceName}
                </Link>
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                <Link
                  href={`/app/boxes/${boxId}`}
                  className="hover:text-foreground hover:underline underline-offset-2 transition-fast"
                >
                  {boxName}
                </Link>
                {folderName && (
                  <>
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                    <span>{folderName}</span>
                  </>
                )}
              </nav>
              {file.path_cache && (
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/40 break-all">
                  {file.path_cache}
                </p>
              )}
            </InfoSection>

            {/* Version / dates */}
            <InfoSection border={false}>
              <InfoLabel>Version</InfoLabel>
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  <span className="font-mono text-[11px] text-foreground/70">
                    {file.current_version_id
                      ? file.current_version_id.slice(0, 8) + "…"
                      : "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  <span className="text-foreground/70">
                    Created {formatDate(file.created_at)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  <span className="text-foreground/70">
                    {formatRelativeDate(file.updated_at)}
                  </span>
                </div>
                {file.origin_type && file.origin_type !== "user_created" && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground/50">Origin:</span>
                    <span className="text-foreground/70">
                      {ORIGIN_LABEL[file.origin_type] ?? file.origin_type}
                    </span>
                  </div>
                )}
              </div>
            </InfoSection>
          </ScrollArea>
        </TabsContent>

        {/* ── Links tab ── */}
        <TabsContent value="links" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-4 py-3">
              <FileObjectLinksPanel
                fileId={file.id}
                outgoing={outgoingLinks}
                incoming={incomingLinks}
                eligibleTargets={eligibleLinkTargets}
              />
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── History tab ── */}
        <TabsContent value="history" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-4 py-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Version history
              </h3>
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No versions recorded yet.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {versions.map((v) => (
                    <VersionItem
                      key={v.id}
                      version={v}
                      isCurrent={v.id === file.current_version_id}
                    />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
