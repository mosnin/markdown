import { type ReactNode } from "react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { AppShell } from "@/components/relay/app-shell";

/**
 * Authenticated app layout.
 *
 * The auth gate for the whole /app tree, and the one place the chassis is
 * assembled. Everything below renders inside the navigation rail.
 *
 * This replaces the previous Context Store shell, which loaded boxes, notes
 * and pending proposals on every route to feed a navigation tree for a product
 * that no longer exists. The relay needs none of that: the rail is static, and
 * each page fetches only what it renders.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await requireAuthenticatedUser();

  return <AppShell workspaceName={ctx.workspace.name}>{children}</AppShell>;
}
