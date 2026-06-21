import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { BoxesBento } from "@/components/product/boxes_bento";

// Bento overview of every box in the workspace. This is the standalone "view
// all your boxes" page (reachable from the Boxes nav item); the dashboard home
// stays the conversation/AI surface. Only the already-fetched box list is
// passed to the grid — no per-box queries (avoids the old N+1).
export default async function BoxesPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  return <BoxesBento boxes={boxes} workspaceName={ctx.workspace.name} />;
}
