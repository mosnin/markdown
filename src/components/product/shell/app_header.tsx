import { type ReactNode } from "react";

interface AppHeaderProps {
  /** Left-aligned breadcrumb or title area */
  left?: ReactNode;
  /** Right-aligned toolbar actions */
  right?: ReactNode;
}

/**
 * Thin top command bar that sits above the main content area.
 * Provides consistent height and padding for breadcrumbs and
 * contextual actions. Keep it lightweight — no nav logic here.
 */
export function AppHeader({ left, right }: AppHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center bg-background border-b border-border">
      <div className="flex flex-1 items-center justify-between gap-4 px-5">
        <div className="flex min-w-0 items-center gap-2">{left}</div>
        {right && (
          <div className="flex shrink-0 items-center gap-1">{right}</div>
        )}
      </div>
    </header>
  );
}
