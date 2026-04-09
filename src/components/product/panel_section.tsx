import { type ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface PanelSectionProps {
  /** Section label */
  title?: string;
  /** Optional action in the label row */
  action?: ReactNode;
  children: ReactNode;
  /** Suppress the separator below the header */
  noSeparator?: boolean;
  className?: string;
}

/**
 * A labeled section used inside side panels, detail views, and cards.
 * Provides consistent label treatment and optional separator.
 */
export function PanelSection({
  title,
  action,
  children,
  noSeparator = false,
  className,
}: PanelSectionProps) {
  return (
    <div className={cn("py-3", className)}>
      {title && (
        <>
          <div className="flex items-center justify-between px-4 pb-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </span>
            {action && <div>{action}</div>}
          </div>
          {!noSeparator && <Separator className="mb-2" />}
        </>
      )}
      <div className="px-4">{children}</div>
    </div>
  );
}
