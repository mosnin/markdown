"use client";

import type { LucideIcon } from "lucide-react";

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

export function SettingsMobileNav({ items }: { items: NavItem[] }) {
  return (
    <nav
      aria-label="Settings sections"
      className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2 md:hidden"
    >
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => {
            document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
