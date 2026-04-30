"use client";

import { ChevronsUpDown, CreditCard, LogOut, Moon, Settings, Sun, User } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/app/app/actions";
import { cn } from "@/lib/utils";

interface UserMenuProps {
  /** Authenticated user's email address */
  email: string;
}

/**
 * Compact user identity row with a sign-out dropdown.
 *
 * Rendered at the bottom of the sidebar. Shows a neutral avatar circle
 * (initials), the user's email truncated, and a quiet chevron affordance.
 * The dropdown opens upward and lists Profile, Settings, Billing, and
 * Sign out (sign out uses destructive ghost styling).
 *
 * Uses the Base UI DropdownMenu with `render` prop pattern — no asChild.
 */
export function UserMenu({ email }: UserMenuProps) {
  // Derive simple initials from the email local part.
  const initials = email
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5",
              "text-left text-foreground transition-colors",
              "hover:bg-accent",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              "aria-expanded:bg-accent"
            )}
            aria-label="User menu"
          />
        }
      >
        {/* Avatar */}
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground"
          aria-hidden="true"
        >
          {initials}
        </div>
        {/* Email */}
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {email}
        </span>
        <ChevronsUpDown
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" sideOffset={6} className="min-w-56">
        <div className="px-2 py-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Signed in as
          </p>
          <p className="mt-0.5 max-w-[200px] truncate text-[13px] font-medium text-foreground">
            {email}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-foreground"
          render={<Link href="/app/settings#settings-profile" />}
        >
          <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2 text-foreground"
          render={<Link href="/app/settings" />}
        >
          <Settings className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2 text-foreground"
          render={<Link href="/app/settings#settings-billing" />}
        >
          <CreditCard className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          Billing
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2 text-foreground"
          onClick={(e) => {
            // Keep the menu open on toggle so users can confirm the change
            e.preventDefault();
            setTheme(isDark ? "light" : "dark");
          }}
        >
          {isDark ? (
            <Sun className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Moon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          )}
          {isDark ? "Light theme" : "Dark theme"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="gap-2"
          onClick={() => void signOut()}
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
