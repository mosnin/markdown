import { after } from "next/server";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { ConversationHomeClient } from "@/components/product/conversation_home_client";
import { ensureDailyNoteAction } from "@/app/app/daily_note/actions";
import { STARTER_BOX_SLUG } from "@/server/services/workspace_bootstrap/seed_starter_box";

export default async function ConversationHomePage() {
  const ctx = await requireAuthenticatedUser();

  after(async () => {
    try {
      await ensureDailyNoteAction();
    } catch {
      // non-critical; never block the page
    }
  });

  const supabase = await createClient();
  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);
  const defaultBoxId = boxes[0]?.id ?? null;

  // First-run signal: a workspace with no real context yet. The seeded
  // "Getting started" box counts as empty for activation purposes, so a
  // user whose only box is the starter still sees the connect-an-agent
  // guidance until they add their own context or wire up an agent.
  const hasOwnContext = boxes.some((box) => box.slug !== STARTER_BOX_SLUG);

  return (
    <ConversationHomeClient
      defaultBoxId={defaultBoxId}
      isFirstRun={!hasOwnContext}
    />
  );
}
