/**
 * Shared-secret auth for Poggle <-> Workspace Operator (Modal) traffic.
 *
 * The Workspace Operator agent runs in Modal and calls back into the Next.js
 * app at `/api/agent/tools/*` to execute tool invocations (search, draft
 * notes, etc.) on behalf of a user in a workspace. These endpoints are
 * internal and must not be exposed to external callers — they enforce a
 * shared HMAC secret, a user_id / workspace_id envelope from the trusted
 * caller (the Modal function), and act through the Supabase service role.
 *
 * Three guarantees each `/api/agent/tools/*` route must uphold:
 *   1. Shared secret header matches `WORKSPACE_OPERATOR_SHARED_SECRET`.
 *   2. The feature flag is on (`isWorkspaceOperatorEnabled()`).
 *   3. The requested workspace_id matches the branch_id on every write
 *      (enforced by service-layer calls, not here).
 *
 * Note: the shared secret lives process-to-process — users never see it,
 * tokens are not revocable from a UI. If the secret leaks, rotate the env
 * var and restart both the Next.js app and the Modal deployment.
 */
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { isWorkspaceOperatorEnabled } from "@/lib/env";

export interface AgentRequestContext {
  userId: string;
  workspaceId: string;
  branchId: string | null;
  runId: string;
}

export type AgentAuthFailure =
  | { kind: "feature_disabled" }
  | { kind: "missing_secret" }
  | { kind: "invalid_secret" }
  | { kind: "missing_envelope"; field: string }
  | { kind: "invalid_envelope"; field: string; reason: string };

export type AgentAuthResult =
  | { ok: true; ctx: AgentRequestContext }
  | { ok: false; failure: AgentAuthFailure };

const SECRET_HEADER = "x-workspace-operator-secret";
const ENVELOPE_HEADERS = {
  userId: "x-workspace-operator-user-id",
  workspaceId: "x-workspace-operator-workspace-id",
  branchId: "x-workspace-operator-branch-id",
  runId: "x-workspace-operator-run-id",
} as const;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Verify an incoming request from the Workspace Operator Modal function and
 * extract the (user, workspace, branch, run) envelope. Returns a discriminated
 * union so the route handler can map each failure to a precise error response.
 */
export function verifyAgentRequest(request: NextRequest): AgentAuthResult {
  if (!isWorkspaceOperatorEnabled()) {
    return { ok: false, failure: { kind: "feature_disabled" } };
  }

  const configuredSecret = process.env.WORKSPACE_OPERATOR_SHARED_SECRET;
  if (!configuredSecret?.trim()) {
    return { ok: false, failure: { kind: "missing_secret" } };
  }

  const providedSecret = request.headers.get(SECRET_HEADER);
  if (!providedSecret || !constantTimeEqual(providedSecret, configuredSecret)) {
    return { ok: false, failure: { kind: "invalid_secret" } };
  }

  const userId = request.headers.get(ENVELOPE_HEADERS.userId);
  const workspaceId = request.headers.get(ENVELOPE_HEADERS.workspaceId);
  const runId = request.headers.get(ENVELOPE_HEADERS.runId);
  const branchId = request.headers.get(ENVELOPE_HEADERS.branchId);

  if (!userId) return { ok: false, failure: { kind: "missing_envelope", field: "user_id" } };
  if (!workspaceId) return { ok: false, failure: { kind: "missing_envelope", field: "workspace_id" } };
  if (!runId) return { ok: false, failure: { kind: "missing_envelope", field: "run_id" } };

  if (!UUID_REGEX.test(userId)) {
    return { ok: false, failure: { kind: "invalid_envelope", field: "user_id", reason: "not a uuid" } };
  }
  if (!UUID_REGEX.test(workspaceId)) {
    return { ok: false, failure: { kind: "invalid_envelope", field: "workspace_id", reason: "not a uuid" } };
  }
  if (branchId && !UUID_REGEX.test(branchId)) {
    return { ok: false, failure: { kind: "invalid_envelope", field: "branch_id", reason: "not a uuid" } };
  }
  if (runId.length < 8 || runId.length > 128) {
    return { ok: false, failure: { kind: "invalid_envelope", field: "run_id", reason: "length out of range" } };
  }

  return {
    ok: true,
    ctx: { userId, workspaceId, branchId: branchId ?? null, runId },
  };
}

export const AGENT_HEADERS = {
  SECRET: SECRET_HEADER,
  USER_ID: ENVELOPE_HEADERS.userId,
  WORKSPACE_ID: ENVELOPE_HEADERS.workspaceId,
  BRANCH_ID: ENVELOPE_HEADERS.branchId,
  RUN_ID: ENVELOPE_HEADERS.runId,
} as const;
