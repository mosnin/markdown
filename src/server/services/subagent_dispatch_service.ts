/**
 * Sub-agent dispatch service.
 *
 * Mirrors the orchestrator's `dispatchOperatorRun` pattern but targets a
 * dedicated sub-agent Modal endpoint. The Modal deployment for sub-agents
 * runs each request in a fresh OpenAI Agent SDK Session with:
 *   - system_prompt = skill.system_prompt
 *   - tools = skill.subagent_tools (whitelist)
 *   - max_turns = skill.subagent_max_turns ?? DEFAULT
 *
 * The Modal function calls back into Next.js at
 * /api/agent/tools/subagent_complete when the run terminates. We do not
 * wait synchronously — the orchestrator polls via await_subagent.
 */
import { AGENT_HEADERS } from "@/app/api/agent/_lib/auth";
import { logger } from "@/lib/logger";

export interface SubagentDispatchInput {
  invocationId: string;
  workspaceId: string;
  userId: string;
  /** Null when dispatching a built-in command (systemPromptOverride is set instead). */
  skillId: string | null;
  task: string;
  allowedTools: string[] | null;
  maxTurns: number;
  depth: number;
  parentRunId: string | null;
  /**
   * Built-in command override. When set, Modal uses this system prompt
   * directly and does not look up a skill row. Used by inline slash
   * commands like `/summarize` and `/rewrite` that don't map to a
   * user-defined skill.
   */
  systemPromptOverride?: string | null;
  /**
   * Stable identifier for the originating inline command (if any). Modal
   * writes back to inline_command_invocations via this id on completion.
   */
  inlineCommandId?: string | null;
}

export interface SubagentDispatchResult {
  /** Modal-side run id used for cancellation + correlation. */
  modalRunId: string;
}

const DEFAULT_MAX_TURNS = 20;
const DISPATCH_TIMEOUT_MS = 30_000; // just the ack, not the full run

export function resolveMaxTurns(skillMax: number | null | undefined): number {
  if (!skillMax) return DEFAULT_MAX_TURNS;
  return Math.max(1, Math.min(100, skillMax));
}

export async function dispatchSubagentRun(
  input: SubagentDispatchInput,
  fetchImpl: typeof fetch = fetch
): Promise<SubagentDispatchResult> {
  const endpoint = process.env.WORKSPACE_SUBAGENT_URL;
  const secret = process.env.WORKSPACE_OPERATOR_SHARED_SECRET;
  if (!endpoint) {
    throw new Error("WORKSPACE_SUBAGENT_URL is not configured");
  }
  if (!secret) {
    throw new Error("WORKSPACE_OPERATOR_SHARED_SECRET is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [AGENT_HEADERS.SECRET]: secret,
        [AGENT_HEADERS.USER_ID]: input.userId,
        [AGENT_HEADERS.WORKSPACE_ID]: input.workspaceId,
        [AGENT_HEADERS.RUN_ID]: input.invocationId,
      },
      body: JSON.stringify({
        invocation_id: input.invocationId,
        workspace_id: input.workspaceId,
        user_id: input.userId,
        skill_id: input.skillId,
        task: input.task,
        allowed_tools: input.allowedTools,
        max_turns: input.maxTurns,
        depth: input.depth,
        parent_run_id: input.parentRunId,
        system_prompt_override: input.systemPromptOverride ?? null,
        inline_command_id: input.inlineCommandId ?? null,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch((err) => { logger.warn({ err }, "failed to read subagent dispatch error response body"); return ""; });
      throw new Error(
        `Subagent dispatch returned ${response.status}: ${text.slice(0, 500)}`
      );
    }

    const payload = (await response.json().catch((err) => { logger.warn({ err }, "failed to parse subagent dispatch response JSON"); return {}; })) as {
      modal_run_id?: string;
    };

    // Modal may return immediately before the run starts; the modal_run_id is
    // the handle we store so later cancellation is possible.
    return {
      modalRunId: typeof payload.modal_run_id === "string" ? payload.modal_run_id : "",
    };
  } finally {
    clearTimeout(timer);
  }
}
