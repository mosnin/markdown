import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listOperatorPrompts } from "@/server/services/operator_prompts_service";
import { OperatorPromptsManager } from "@/components/product/operator_prompts_manager";

/**
 * Saved Operator prompts management page.
 *
 * Lists the current user's saved prompts in the active workspace and
 * delegates create / edit / delete to the OperatorPromptsManager
 * client component (which calls server actions in prompts_actions.ts).
 */
export default async function OperatorPromptsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const initialPrompts = await listOperatorPrompts(supabase, {
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-background">
        <div className="px-6 pt-6 pb-4">
          <Link
            href="/app/workspace_operator"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Back to history
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            Saved prompts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reusable prompts for the Workspace Operator. Private to you.
          </p>
        </div>
        <Separator />
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <OperatorPromptsManager initialPrompts={initialPrompts} />
        </div>
      </div>
    </div>
  );
}
