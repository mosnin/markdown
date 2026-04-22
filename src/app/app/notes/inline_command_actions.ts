"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { getNoteById } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import {
  createInlineCommandInvocation,
  getInlineCommandInvocationById,
  updateInlineCommandInvocation,
} from "@/server/repositories/inline_command_repository";
import { createSubagentInvocation } from "@/server/repositories/subagent_invocation_repository";
import {
  dispatchSubagentRun,
  resolveMaxTurns,
} from "@/server/services/subagent_dispatch_service";
import {
  BUILT_IN_COMMANDS,
  type BuiltInCommandId,
} from "@/server/domain/types/inline_command";
import { checkRateLimit } from "@/lib/api/rate_limit";

export type RunInlineCommandResult =
  | {
      ok: true;
      invocation_id: string;
      subagent_invocation_id: string | null;
    }
  | { ok: false; error: string };

const INLINE_COMMAND_RATE_LIMIT_PER_MIN = 30;

/**
 * Launches a slash-command invocation from the note editor.
 *
 * command_id is either a built-in ("summarize", "translate", ...) or
 * "skill:<uuid>" for a workspace sub-agent skill.
 *
 * Returns the invocation id immediately — the client opens an SSE
 * stream on /api/agent/subagents/[id]/stream (or polls the inline
 * command row) to consume incremental output.
 */
export async function runInlineCommandAction(input: {
  noteId: string;
  commandId: string;
  context: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  /** For built-in "translate": the target language. */
  argument?: string | null;
}): Promise<RunInlineCommandResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const rl = await checkRateLimit(
      `inline_command:${ctx.user.id}`,
      INLINE_COMMAND_RATE_LIMIT_PER_MIN,
      60
    );
    if (!rl.allowed) {
      return {
        ok: false,
        error: `Inline command rate limit. Try again in ${rl.retryAfter}s.`,
      };
    }

    const note = await getNoteById(supabase, input.noteId);
    if (!note) return { ok: false, error: "Note not found" };
    const box = await getBoxById(supabase, note.box_id);
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not authorised" };
    }

    const admin = createAdminClient();

    // Resolve the skill id for this command (built-in or skill:<uuid>).
    let skillId: string | null = null;
    let systemPrompt: string | null = null;
    if (input.commandId.startsWith("skill:")) {
      const rawId = input.commandId.slice("skill:".length);
      const { data: skill } = await admin
        .from("skills")
        .select(
          "id, workspace_id, is_subagent, subagent_tools, subagent_max_turns"
        )
        .eq("id", rawId)
        .maybeSingle();
      if (
        !skill ||
        skill.workspace_id !== ctx.workspace.id ||
        !skill.is_subagent
      ) {
        return { ok: false, error: "Skill is not a sub-agent" };
      }
      skillId = skill.id as string;
    } else {
      const builtIn = BUILT_IN_COMMANDS.find((c) => c.id === input.commandId);
      if (!builtIn) {
        return { ok: false, error: "Unknown command" };
      }
      systemPrompt = builtIn.system_prompt;
    }

    const invocation = await createInlineCommandInvocation(admin, {
      workspace_id: ctx.workspace.id,
      user_id: ctx.user.id,
      note_id: input.noteId,
      command_id: input.commandId,
      selection_start: input.selectionStart ?? null,
      selection_end: input.selectionEnd ?? null,
    });

    // Build the sub-agent task payload.
    const argSuffix = input.argument ? `\n\nTarget: ${input.argument}` : "";
    const taskPrefix = systemPrompt
      ? `[Inline command "${input.commandId}"] ${systemPrompt}\n\n`
      : "";
    const task = `${taskPrefix}Context:\n\n${input.context}${argSuffix}`;

    // Dispatch via sub-agent infrastructure. For built-ins without a
    // backing skill, we still need a skill id — the Modal runtime resolves
    // "built-in" commands by matching command_id. For v1, require a
    // skill when command_id !== built-in; built-ins run as a thin Pog call
    // without delegation.
    //
    // Simpler v1: for built-ins without a skill, we return the invocation
    // id and defer resolution to the Modal harness (which reads
    // inline_command_invocations directly by id). For skill-backed
    // commands, we link to a sub-agent invocation row.
    let subagentInvocationId: string | null = null;
    if (skillId) {
      const subagent = await createSubagentInvocation(admin, {
        workspace_id: ctx.workspace.id,
        parent_operator_run_id: null,
        skill_id: skillId,
        user_id: ctx.user.id,
        task,
        depth: 1,
      });
      subagentInvocationId = subagent.id;

      try {
        const { modalRunId } = await dispatchSubagentRun({
          invocationId: subagent.id,
          workspaceId: ctx.workspace.id,
          userId: ctx.user.id,
          skillId,
          task,
          allowedTools: null,
          maxTurns: resolveMaxTurns(null),
          depth: 1,
          parentRunId: invocation.id,
        });
        await updateInlineCommandInvocation(admin, invocation.id, {
          subagent_invocation_id: subagent.id,
        });
        await admin
          .from("subagent_invocations")
          .update({ status: "running", modal_run_id: modalRunId })
          .eq("id", subagent.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await updateInlineCommandInvocation(admin, invocation.id, {
          status: "failed",
          error: msg,
          completed_at: new Date().toISOString(),
        });
        return { ok: false, error: msg };
      }
    }

    return {
      ok: true,
      invocation_id: invocation.id,
      subagent_invocation_id: subagentInvocationId,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to run command",
    };
  }
}

export type InlineCommandStatusResult =
  | {
      ok: true;
      status: "running" | "completed" | "failed" | "cancelled";
      output: string | null;
      error: string | null;
    }
  | { ok: false; error: string };

export async function getInlineCommandStatusAction(
  invocationId: string
): Promise<InlineCommandStatusResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const admin = createAdminClient();
    const row = await getInlineCommandInvocationById(admin, invocationId);
    if (!row) return { ok: false, error: "Not found" };
    if (row.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not authorised" };
    }
    return {
      ok: true,
      status: row.status,
      output: row.output,
      error: row.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load status",
    };
  }
}

export type ListSkillsForSlashResult =
  | {
      ok: true;
      data: Array<{ id: string; name: string; description: string | null }>;
    }
  | { ok: false; error: string };

export async function listSkillsForSlashMenuAction(): Promise<ListSkillsForSlashResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("skills")
      .select("id, name, description")
      .eq("workspace_id", ctx.workspace.id)
      .eq("is_subagent", true)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return {
      ok: true,
      data: (data ?? []).map((r) => ({
        id: r.id as string,
        name: (r.name as string) ?? "",
        description: (r.description as string | null) ?? null,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load skills",
    };
  }
}

export async function cancelInlineCommandAction(
  invocationId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireAuthenticatedUser();
    const admin = createAdminClient();
    const row = await getInlineCommandInvocationById(admin, invocationId);
    if (!row) return { ok: false, error: "Not found" };
    if (row.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not authorised" };
    }
    if (row.status !== "running") return { ok: true };
    await updateInlineCommandInvocation(admin, invocationId, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
    });
    if (row.subagent_invocation_id) {
      await admin
        .from("subagent_invocations")
        .update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.subagent_invocation_id);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to cancel",
    };
  }
}
