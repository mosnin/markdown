import { type User } from "@supabase/supabase-js";
import { requireAdmin } from "@/server/auth/require_admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { Separator } from "@/components/ui/separator";
import { UserTable, type UserRow } from "./user_table";

/**
 * Admin: User management page.
 *
 * Fetches all users from auth.users via the service-role admin client,
 * handling Supabase's paginated listUsers API by iterating until all pages
 * are collected. For each user, fetches their workspace from the workspaces
 * table.
 *
 * Renders a client-side searchable, paginated table with suspend/unsuspend
 * actions.
 */
export default async function AdminUsersPage() {
  // Auth guard — only admins may reach this page
  await requireAdmin();

  const adminClient = createAdminClient();

  // ── Fetch all users — paginate through auth.admin.listUsers ───────────────
  // Supabase returns up to 1000 users per page; we loop until done.
  const allUsers: User[] = [];

  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      // Surface error but don't crash the page
      console.error("[admin/users] listUsers error:", error.message);
      break;
    }

    allUsers.push(...data.users);

    // Supabase doesn't expose hasNextPage reliably; stop when the page
    // returns fewer items than requested.
    if (data.users.length < perPage) break;
    page++;
  }

  // ── Fetch all workspaces in a single query ────────────────────────────────
  // We join by owner_id so we can correlate workspace → user without N+1.
  const { data: workspaceRows } = await adminClient
    .from("workspaces")
    .select("id, owner_id, name, slug")
    .order("created_at", { ascending: false });

  // Build a lookup: owner_id → workspace row (first/most recent workspace)
  const workspaceByOwner = new Map<
    string,
    { id: string; name: string; slug: string }
  >();

  for (const ws of workspaceRows ?? []) {
    // Keep only the first we encounter (most-recent due to order above)
    if (!workspaceByOwner.has(ws.owner_id)) {
      workspaceByOwner.set(ws.owner_id, {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
      });
    }
  }

  // ── Build UserRow array for the client component ──────────────────────────
  const userRows: UserRow[] = allUsers.map((u) => {
    const ws = workspaceByOwner.get(u.id) ?? null;
    return {
      id: u.id,
      email: u.email ?? "(no email)",
      workspace_name: ws?.name ?? null,
      workspace_slug: ws?.slug ?? null,
      // No billing table yet — everyone is on free
      plan: "free" as const,
      banned_until: u.banned_until ?? null,
      created_at: u.created_at,
    };
  });

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Page header */}
      <div className="bg-background">
        <div className="px-6 pt-6 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Users
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {allUsers.length} registered user{allUsers.length !== 1 ? "s" : ""}.
            Search, inspect, and manage access.
          </p>
        </div>
        <Separator />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <UserTable
          users={userRows}
          page={1}
          totalPages={Math.max(1, Math.ceil(userRows.length / 50))}
        />
      </div>
    </div>
  );
}
