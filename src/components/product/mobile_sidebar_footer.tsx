"use client";

import Link from "next/link";
import { LogOut, Moon, Sun, Settings as SettingsIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { signOut } from "@/app/app/actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MobileSidebarFooterProps {
  userEmail?: string;
  /** Whether the current route is /app/settings — used for active styling */
  isSettingsActive?: boolean;
  /** Called before navigation so the parent sheet can close itself */
  onNavigate?: () => void;
}

/**
 * Bottom-of-sheet chrome for the mobile nav + settings sheets.
 *
 * This deliberately does NOT use the normal `<ThemeToggle />` or
 * `<UserMenu />` components because both wrap a Base UI popup primitive
 * (Tooltip and DropdownMenu, respectively) that renders via a Floating
 * UI Portal. Stacking a Tooltip portal + a DropdownMenu portal *inside*
 * the Sheet's own Dialog portal makes three peer portaled overlays in
 * the floating-ui root, and Base UI 1.3.0 intermittently fails to mount
 * the outer Sheet when the inner portals register first on touch
 * devices — the hamburger click then appears to "do nothing" because
 * the Sheet's popup is never attached to the DOM.
 *
 * See the commit fixing the mobile sidebar portal collision for the
 * full explanation. The desktop sidebar is unaffected because its
 * container is not itself a Dialog.
 *
 * Everything here is rendered inline (no portal, no Floating UI) so the
 * Sheet is the only portaled popup on the page while it's open.
 */
export function MobileSidebarFooter({
  userEmail,
  isSettingsActive = false,
  onNavigate,
}: MobileSidebarFooterProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const initials = userEmail
    ? userEmail.split("@")[0]!.slice(0, 2).toUpperCase()
    : "";

  return (
    <div className="border-t border-sidebar-border">
      <div className="flex items-center justify-between px-3 py-2">
        <Link
          href="/app/settings"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2 rounded-md p-1.5 text-sidebar-foreground/60 transition-fast text-sm",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            isSettingsActive && "text-sidebar-accent-foreground",
          )}
          aria-label="Settings"
          aria-current={isSettingsActive ? "page" : undefined}
        >
          <SettingsIcon className="h-4 w-4" aria-hidden="true" />
          <span>Settings</span>
        </Link>

        {/* Plain theme-toggle button — no Tooltip wrapper to avoid a
            Floating UI portal stacking on top of the Sheet's own portal. */}
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "h-8 w-8 text-muted-foreground hover:text-foreground",
          )}
        >
          <Sun
            className={cn(
              "h-4 w-4 transition-all",
              isDark ? "rotate-90 scale-0" : "rotate-0 scale-100",
            )}
          />
          <Moon
            className={cn(
              "absolute h-4 w-4 transition-all",
              isDark ? "rotate-0 scale-100" : "rotate-90 scale-0",
            )}
          />
        </button>
      </div>

      {userEmail && (
        <div className="border-t border-sidebar-border px-2 py-2">
          {/* Inline user row — shows email + a plain Sign out button.
              Previously this was <UserMenu /> which wraps a Base UI
              DropdownMenu; that dropdown's Floating UI portal nested
              inside the Sheet's portal is what blocked the sheet from
              opening on mobile touch devices. An inline, non-portaled
              layout is sufficient here: the user only needs Settings
              (already linked above) and Sign out. */}
          <div className="flex items-center gap-2 px-1.5 py-1">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
              {initials}
            </div>
            <span
              className="min-w-0 flex-1 truncate text-xs text-sidebar-foreground/70"
              title={userEmail}
            >
              {userEmail}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                aria-label="Sign out"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md",
                  "text-sidebar-foreground/60 transition-fast",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
