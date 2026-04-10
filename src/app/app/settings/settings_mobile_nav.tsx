"use client";

import { Bell, Building2, CreditCard, Key, Palette, Shield, User } from "lucide-react";

// Nav items are static — hardcoded here to avoid passing icon functions
// (non-serializable) as props from server component to client component.
const NAV_ITEMS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "billing", label: "Billing & Plans", icon: CreditCard },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "connections", label: "Connections", icon: Key },
  { id: "security", label: "Security", icon: Shield },
];

export function SettingsMobileNav() {
  return (
    <nav
      aria-label="Settings sections"
      className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2 md:hidden"
    >
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => {
            document
              .getElementById(`settings-${id}`)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-fast hover:bg-accent hover:text-foreground"
        >
          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  );
}
