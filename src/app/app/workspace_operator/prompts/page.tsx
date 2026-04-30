import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listOperatorPrompts } from "@/server/services/operator_prompts_service";
import { OperatorPromptsManager } from "@/components/product/operator/operator_prompts_manager";
import { PageHeader } from "@/components/product/page_header";

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
      <PageHeader
        title="Saved prompts"
        description="Reusable prompts for the Workspace Operator. Private to you."
        actions={
          <Link
            href="/app/workspace_operator"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            History
          </Link>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <OperatorPromptsManager initialPrompts={initialPrompts} />
        </div>
      </div>
    </div>
  );
}
