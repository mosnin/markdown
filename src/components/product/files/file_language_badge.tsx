import { type SourceFormat } from "@/server/domain/constants/object_constants";
import { getFormatInfo } from "@/lib/file_format_utils";
import { cn } from "@/lib/utils";

interface FileLanguageBadgeProps {
  format: SourceFormat;
  /** Raw file extension stored on the file row, e.g. ".py". Used for display when available. */
  extension?: string | null;
  className?: string;
  /** Whether to show the extension alongside the label */
  showExtension?: boolean;
}

/**
 * Compact badge indicating the canonical source format of a file.
 *
 * Displays the format label (e.g. "TypeScript") and optionally the extension.
 * Never shown for notes — markdown is handled by note-specific UI.
 */
export function FileLanguageBadge({
  format,
  extension,
  className,
  showExtension = false,
}: FileLanguageBadgeProps) {
  const info = getFormatInfo(format);
  const ext = extension ?? info.extension;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40",
        "px-2 py-0.5 font-mono text-[10px] text-muted-foreground",
        className
      )}
      title={`Source format: ${info.label}`}
    >
      {info.label}
      {showExtension && ext && (
        <span className="opacity-50">{ext}</span>
      )}
    </span>
  );
}
