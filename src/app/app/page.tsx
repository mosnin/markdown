import { after } from "next/server";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { ConversationHomeClient } from "@/components/product/conversation_home_client";
import { ensureDailyNoteAction } from "@/app/app/daily_note/actions";

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

  return <ConversationHomeClient defaultBoxId={defaultBoxId} />;
}
