"use client";

import { usePathname } from "next/navigation";
import { type Box as BoxType } from "@/server/domain/types/box";
import { AppSidebar } from "@/components/product/shell/app_sidebar";
import { SettingsSidebar } from "@/components/product/settings_sidebar";

interface AppShellSidebarProps {
  userEmail?: string;
  workspaceName?: string;
  workspaceId?: string;
  boxes?: BoxType[];
  workspaces?: Array<{ id: string; name: string; slug: string }>;
  /**
   * Minimal shape of the 5 most-recently-updated notes in the workspace,
   * rendered by AppSidebar's "Recent" section. Server-fetched in the
   * /app layout and forwarded through this shell wrapper.
   */
  recentNotes?: Array<{
    id: string;
    title: string;
    box_id: string;
    updated_at: string;
  }>;
  /** Count of pending write proposals — forwarded to AppSidebar for the badge. */
  pendingProposalsCount?: number;
}

/**
 * Thin client wrapper that chooses between the main AppSidebar and the
 * SettingsSidebar based on the current pathname. Swaps in-place so the
 * shell chrome (width, borders, workspace switcher pill, bottom chrome)
 * stays stable and the nav body swaps content.
 *
 * On /app/settings the SettingsSidebar replaces the main nav + boxes
 * tree. Navigating away (via the "Back to workspace" link or any other
 * primary-nav destination) restores the main sidebar automatically via
 * pathname change.
 *
 * The analytics page (/app/analytics) also shows the settings sidebar
 * because it is linked from the workspace-admin section there.
 */
export function AppShellSidebar(props: AppShellSidebarProps) {
  const pathname = usePathname();
  const isSettings =
    pathname === "/app/settings" ||
    pathname.startsWith("/app/settings/") ||
    pathname === "/app/analytics";

  if (isSettings) {
    return (
      <SettingsSidebar
        userEmail={props.userEmail}
        workspaceName={props.workspaceName}
        workspaceId={props.workspaceId}
        workspaces={props.workspaces}
      />
    );
  }

  return <AppSidebar {...props} />;
}
