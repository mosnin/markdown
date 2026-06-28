"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppWindow,
  ArrowLeft,
  ArrowRightLeft,
  BarChart3,
  Bell,
  Building2,
  Code2,
  CreditCard,
  Fingerprint,
  GitBranch,
  Key,
  Mail,
  Palette,
  Shield,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * In-page settings sub-navigation.
 *
 * The global chrome is now a single FloatingShell (no per-route sidebar
 * swap), so the settings section nav that used to live in SettingsSidebar
 * moves here, scoped to the settings page. Account sections are in-page
 * anchor jumps (#settings-*); developer / workspace / security entries
 * navigate to their dedicated routes and highlight when active.
 *
 * Desktop: a sticky left rail. Mobile: a horizontally scrollable strip of
 * the account anchors (the route groups remain reachable from the page body
 * and the workspace switcher).
 */

const accountNav = [
  { id: "profile", label: "Profile", icon: User },
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "billing", label: "Billing & Plans", icon: CreditCard },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "connections", label: "Connections", icon: Key },
  { id: "security", label: "Security", icon: Shield },
];

const developerNav = [
  { href: "/app/settings/oauth_clients", label: "OAuth Clients", subLabel: "Apps you've registered", icon: Code2 },
  { href: "/app/settings/connected_apps", label: "Connected Apps", subLabel: "Apps with access to your workspace", icon: AppWindow },
  { href: "/app/settings/connections/migration", label: "Legacy migration", subLabel: "Migrate csk_v1_ tokens to OAuth", icon: ArrowRightLeft },
];

const operatorNav = [
  { href: "/app/settings/operator_preferences", label: "Operator preferences", subLabel: "Email notifications & API keys", icon: Mail },
];

const workspaceAdminNav = [
  { href: "/app/analytics", label: "Analytics", subLabel: "Workspace health & content metrics", icon: BarChart3 },
  { href: "/app/settings/workspace/members", label: "Members", subLabel: "Invite & manage team members", icon: Users },
  { href: "/app/settings/workspace/branch_retention", label: "Branch retention", subLabel: "Auto-discard idle branches", icon: GitBranch },
  { href: "/app/settings/workspace/semantic_search", label: "Semantic search", subLabel: "Reindex vector embeddings", icon: Sparkles },
];

const securityNav = [
  { href: "/app/settings/security/passkeys", label: "Passkeys", subLabel: "Passwordless sign-in", icon: Fingerprint },
];

const routeGroups = [
  { heading: "Developer & Apps", items: developerNav },
  { heading: "Workspace Operator", items: operatorNav },
  { heading: "Workspace admin", items: workspaceAdminNav },
  { heading: "Security", items: securityNav },
];

export function SettingsSubnav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings sections"
      className="hidden w-60 shrink-0 border-r border-border/40 md:flex md:flex-col"
    >
      {/* Back to workspace */}
      <div className="px-2 pb-1 pt-3">
        <Link
          href="/app"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
            "text-foreground/60 hover:bg-accent/60 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Back to workspace</span>
        </Link>
      </div>

      <ScrollArea className="flex-1 px-2 pb-3">
        <p className="mb-1 mt-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/40">
          Settings
        </p>
        <ul className="flex list-none flex-col gap-0.5">
          {accountNav.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <Link
                href={`/app/settings#settings-${id}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
                  "text-foreground/70 hover:bg-accent/60 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          ))}
        </ul>

        {routeGroups.map((group) => (
          <div key={group.heading}>
            <p className="mb-1 mt-4 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/40">
              {group.heading}
            </p>
            <ul className="flex list-none flex-col gap-0.5">
              {group.items.map(({ href, label, subLabel, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
                        "text-foreground/70 hover:bg-accent/60 hover:text-foreground",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active && "bg-accent/60 text-foreground"
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="truncate">{label}</span>
                        <span className="truncate text-[10px] text-foreground/40">
                          {subLabel}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </ScrollArea>
    </nav>
  );
}
