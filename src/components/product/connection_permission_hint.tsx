import { Eye, FileEdit, Sparkles, Globe, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ConnectionPermissionHint
 *
 * Compact inline hint that explains what a connection can and cannot do
 * with the current object. Used in object detail pages and connection settings.
 *
 * Stays factual and calm. Not a wall of text. Uses concise labels.
 *
 * Permission modes:
 *   read_only                  — can read, cannot write
 *   propose_writes             — can read + submit proposals for human review
 *   generate_in_allowed_folders — can read + propose + create notes in
 *                                  pre-authorized folders (not shared objects)
 */

type PermissionMode = "read_only" | "propose_writes" | "generate_in_allowed_folders";

interface ConnectionPermissionHintProps {
  permissionMode: PermissionMode;
  /** When true, extra hint about reusable-object-level protection is shown. */
  isReusableObject?: boolean;
  /** Object type for context. */
  objectType?: "note" | "file" | "skill" | "agent";
  compact?: boolean;
  className?: string;
}

const MODE_CONFIG: Record<PermissionMode, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
}> = {
  read_only: {
    icon: Eye,
    label: "Read only",
    detail: "Connections with this mode can read context but cannot propose changes.",
  },
  propose_writes: {
    icon: FileEdit,
    label: "Propose writes",
    detail: "Connections can submit write proposals. Changes require human approval before taking effect.",
  },
  generate_in_allowed_folders: {
    icon: Sparkles,
    label: "Generate in allowed folders",
    detail: "Connections can create notes in pre-authorized folders and submit proposals. Cannot directly modify shared objects.",
  },
};

export function ConnectionPermissionHint({
  permissionMode,
  isReusableObject = false,
  objectType,
  compact = false,
  className,
}: ConnectionPermissionHintProps) {
  const config = MODE_CONFIG[permissionMode];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-border/50 bg-muted/20 p-3",
        className
      )}
      role="note"
      aria-label="Connection permission hint"
    >
      <div className="flex items-center gap-2 text-xs">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">{config.label}</span>
      </div>

      {!compact && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {config.detail}
        </p>
      )}

      {/* Reusable object extra hint */}
      {isReusableObject && permissionMode !== "read_only" && (
        <div className="flex items-start gap-1.5 rounded border border-border/40 bg-muted/30 px-2.5 py-2 text-xs">
          <Lock className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">
            This is a workspace-shared {objectType ?? "object"}.
            External connections can only propose changes — not directly mutate it.
            A human owner must approve any proposal before the content changes.
          </span>
        </div>
      )}

      {/* Scope hint */}
      {permissionMode === "generate_in_allowed_folders" && isReusableObject && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
          <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            Generate-in-folders permission does not bypass reusable object protection.
          </span>
        </div>
      )}
    </div>
  );
}
