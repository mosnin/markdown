import { type ReactNode } from "react";

interface AppHeaderProps {
  /** Left-aligned breadcrumb or title area */
  left?: ReactNode;
  /** Right-aligned toolbar actions */
  right?: ReactNode;
}

/**
 * Quiet 48px top command bar that sits above the main content area.
 * Hairline border-b, bg-background, with a tight gap between left content
 * and right-aligned actions. Keep it lightweight — no nav logic here.
 */
export function AppHeader({ left, right }: AppHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3 md:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">{left}</div>
      {right && (
        <div className="flex shrink-0 items-center gap-1" role="toolbar">
          {right}
        </div>
      )}
    </header>
  );
}
