import { AlertTriangle, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SharedReferenceImpactNotice
 *
 * Informational notice shown when a user is about to archive or trash a
 * workspace-reusable skill or agent that has attached box references.
 *
 * Explains clearly and calmly what will happen:
 *   - Existing attachments remain (not silently deleted)
 *   - Attached references will show a degraded state
 *   - The human can restore or detach later
 *
 * This is NOT an error. It is factual information to help the owner
 * make an informed decision. Tone: calm, technical, not alarmist.
 */

interface SharedReferenceImpactNoticeProps {
  objectType: "skill" | "agent";
  objectName: string;
  /** Number of boxes currently attached to this object. */
  attachedBoxCount: number;
  /** Action being taken: archive or trash */
  action: "archive" | "trash";
  className?: string;
}

export function SharedReferenceImpactNotice({
  objectType,
  objectName,
  attachedBoxCount,
  action,
  className,
}: SharedReferenceImpactNoticeProps) {
  if (attachedBoxCount === 0) return null;

  const typeLabel = objectType.charAt(0).toUpperCase() + objectType.slice(1);
  const boxLabel = attachedBoxCount === 1 ? "1 box" : `${attachedBoxCount} boxes`;
  const actionPast = action === "archive" ? "archived" : "trashed";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-amber-500/30",
        "bg-amber-500/8 px-4 py-3 text-sm",
        className
      )}
      role="note"
      aria-label="Impact notice for shared object"
    >
      <Globe className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-foreground">
          {typeLabel} is attached to {boxLabel}
        </p>
        <p className="text-xs text-muted-foreground">
          &ldquo;{objectName}&rdquo; is currently attached to {boxLabel} by reference.
          If you {action} it, the {boxLabel.split(" ")[1]} {attachedBoxCount === 1 ? "attachment" : "attachments"} will remain
          but display a degraded state until the {typeLabel.toLowerCase()} is restored
          or detached.
        </p>
        <p className="text-xs text-muted-foreground/70">
          Attachments are not automatically removed. You can restore this {typeLabel.toLowerCase()} later or detach it from boxes manually.
        </p>
      </div>
    </div>
  );
}

/**
 * ReusableObjectDegradedBadge
 *
 * Small badge shown on attached references in the box tree when the
 * source reusable object has been archived or trashed.
 * Signals the degraded state without hiding the attachment.
 */
interface ReusableObjectDegradedBadgeProps {
  status: "archived" | "trashed";
  className?: string;
}

export function ReusableObjectDegradedBadge({
  status,
  className,
}: ReusableObjectDegradedBadgeProps) {
  const label = status === "archived" ? "Source archived" : "Source trashed";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]",
        status === "archived"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "border-destructive/40 bg-destructive/10 text-destructive",
        className
      )}
      aria-label={label}
      title={label}
    >
      <AlertTriangle className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
