"use client";

import { usePathname } from "next/navigation";
import { type Box as BoxType } from "@/server/domain/types/box";
import { MobileSidebar } from "@/components/product/shell/mobile_sidebar";
import { MobileSettingsSidebar } from "@/components/product/shell/mobile_settings_sidebar";

interface MobileShellSidebarProps {
  userEmail?: string;
  workspaceName?: string;
  workspaceId?: string;
  boxes?: BoxType[];
  workspaces?: Array<{ id: string; name: string; slug: string }>;
}

/**
 * Mobile sidebar wrapper that swaps between the main MobileSidebar
 * and the MobileSettingsSidebar based on pathname. Mirrors the
 * desktop AppShellSidebar behavior for small screens.
 */
export function MobileShellSidebar(props: MobileShellSidebarProps) {
  const pathname = usePathname();
  const isSettings = pathname === "/app/settings" || pathname.startsWith("/app/settings/") || pathname === "/app/analytics";

  if (isSettings) {
    return (
      <MobileSettingsSidebar
        userEmail={props.userEmail}
        workspaceName={props.workspaceName}
        workspaceId={props.workspaceId}
        workspaces={props.workspaces}
      />
    );
  }

  return <MobileSidebar {...props} />;
}
