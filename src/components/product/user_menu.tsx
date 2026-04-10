"use client";

import { LogOut, Settings } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { signOut } from "@/app/app/actions";
import { cn } from "@/lib/utils";

interface UserMenuProps {
  /** Authenticated user's email address */
  email: string;
}

/**
 * Compact user identity row with a sign-out dropdown.
 *
 * Rendered at the bottom of the sidebar. Shows the user's email
 * (truncated) and a dropdown with the sign out action.
 *
 * Uses the Base UI DropdownMenu with `render` prop pattern — no asChild.
 */
export function UserMenu({ email }: UserMenuProps) {
  // Derive simple initials from the email local part.
  const initials = email
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
            )}
            aria-label="User menu"
          />
        }
      >
        {/* Avatar */}
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
          {initials}
        </div>
        {/* Email */}
        <span className="min-w-0 flex-1 truncate text-left text-xs text-sidebar-foreground/70">
          {email}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" sideOffset={6}>
        <div className="px-1.5 py-1">
          <p className="text-xs text-muted-foreground/70">Signed in as</p>
          <p className="max-w-[180px] truncate text-xs font-medium text-foreground">
            {email}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-muted-foreground"
          render={<Link href="/app/settings" />}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-muted-foreground"
          onClick={() => void signOut()}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
