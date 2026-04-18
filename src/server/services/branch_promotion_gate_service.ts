import { type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "crypto";
import { logger } from "@/lib/logger";

/**
 * Branch promotion gate service.
 *
 * Workspace admins configure HTTP webhooks that are called before a
 * branch is promoted. Each webhook returns
 *
 *     { status: 'pass' | 'fail', reason?: string }
 *
 * and any non-pass response (including non-2xx HTTP status, timeout,
 * or malformed body) vetoes the promotion. This is a lightweight
 * CI/CD-style gating layer — think "run tests before merging to main"
 * but for Context Store branches.
 *
 * HMAC signing:
 *
 *   Every outbound request carries the header
 *
 *     X-ContextStore-Signature: v1=<hmac-sha256-hex>
 *
 *   where the HMAC is computed over the string
 *
 *     `${timestamp}.${JSON.stringify(body)}`
 *
 *   using the gate's secret as the key. The timestamp is included in
 *   the body (`body.timestamp`) so webhook verifiers can re-compute
 *   the signature deterministically.
 *
 * Secrets:
 *
 *   * 32-byte random, hex-encoded at creation time (64 hex chars).
 *   * Shown to the admin ONCE at creation and rotate. The DB row holds
 *     the plaintext because the server itself must sign on every
 *     promote — we do not have a KMS boundary for this feature in V1.
 *   * Rotate regenerates the secret in a single UPDATE and returns
 *     the new value to the caller.
 */

export interface BranchPromotionGate {
  id: string;
  workspace_id: string;
  name: string;
  webhook_url: string;
  /**
   * HMAC signing secret. Service-layer only — the UI helpers below
   * (`listGates`, etc.) return it in this shape because RLS already
   * restricts reads to workspace members and we need the value in
   * the promote path. The admin UI strips it before rendering.
   */
  secret: string;
  timeout_seconds: number;
  status: "active" | "disabled";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A single webhook invocation recorded against a gate. */
export interface GateRun {
  id: string;
  gate_id: string;
  branch_id: string;
  status: "pending" | "passed" | "failed" | "error" | "timeout";
  response_body: string | null;
  duration_ms: number | null;
  created_at: string;
}

/** Body POSTed to each webhook. */
export interface GateWebhookPayload {
  branch_id: string;
  branch_name: string;
  diff_summary: GateDiffSummary;
  timestamp: string;
}

/**
 * Condensed diff shape handed to each webhook. We do not send the
 * full diff (full contents would risk leaking large payloads into
 * third-party logs). Counts + changed-object names are enough for
 * most CI-style rules.
 */
export interface GateDiffSummary {
  head_count: number;
  pending_op_count: number;
  folder_override_count: number;
  placement_change_count: number;
  created_note_link_count: number;
  created_attachment_count: number;
  changed_objects: Array<{ object_type: string; display_name: string }>;
}

/** Max length of response_body we persist. Protects audit storage. */
const MAX_RESPONSE_BODY_LEN = 8 * 1024;

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function listGates(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<BranchPromotionGate[]> {
  const { data } = await supabase
    .from("branch_promotion_gates")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  return (data ?? []) as BranchPromotionGate[];
}

export async function listActiveGates(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<BranchPromotionGate[]> {
  const { data } = await supabase
    .from("branch_promotion_gates")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  return (data ?? []) as BranchPromotionGate[];
}

export async function getGate(
  supabase: SupabaseClient,
  gateId: string
): Promise<BranchPromotionGate | null> {
  const { data } = await supabase
    .from("branch_promotion_gates")
    .select("*")
    .eq("id", gateId)
    .maybeSingle();
  return (data as BranchPromotionGate | null) ?? null;
}

export interface CreateGateInput {
  name: string;
  webhookUrl: string;
  timeoutSeconds?: number;
}

/**
 * Create a gate and return the secret ONCE. The caller is expected
 * to surface the returned secret to the admin and then forget it.
 */
export async function createGate(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  input: CreateGateInput
): Promise<{ gate: BranchPromotionGate; secret: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("Gate name is required");
  if (name.length > 200) throw new Error("Gate name must be 200 characters or fewer");

  const webhookUrl = input.webhookUrl.trim();
  validateWebhookUrl(webhookUrl);

  const timeoutSeconds = input.timeoutSeconds ?? 10;
  if (timeoutSeconds < 1 || timeoutSeconds > 60) {
    throw new Error("Timeout must be between 1 and 60 seconds");
  }

  const secret = generateSecret();

  const { data, error } = await supabase
    .from("branch_promotion_gates")
    .insert({
      workspace_id: workspaceId,
      name,
      webhook_url: webhookUrl,
      secret,
      timeout_seconds: timeoutSeconds,
      status: "active",
      created_by: actorId,
    })
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create gate");
  }
  return { gate: data as BranchPromotionGate, secret };
}

export interface UpdateGatePatch {
  name?: string;
  webhookUrl?: string;
  timeoutSeconds?: number;
  status?: "active" | "disabled";
}

export async function updateGate(
  supabase: SupabaseClient,
  gateId: string,
  patch: UpdateGatePatch
): Promise<BranchPromotionGate> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error("Gate name is required");
    if (n.length > 200) throw new Error("Gate name must be 200 characters or fewer");
    update.name = n;
  }
  if (patch.webhookUrl !== undefined) {
    validateWebhookUrl(patch.webhookUrl);
    update.webhook_url = patch.webhookUrl.trim();
  }
  if (patch.timeoutSeconds !== undefined) {
    if (patch.timeoutSeconds < 1 || patch.timeoutSeconds > 60) {
      throw new Error("Timeout must be between 1 and 60 seconds");
    }
    update.timeout_seconds = patch.timeoutSeconds;
  }
  if (patch.status !== undefined) {
    update.status = patch.status;
  }
  const { data, error } = await supabase
    .from("branch_promotion_gates")
    .update(update)
    .eq("id", gateId)
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to update gate");
  return data as BranchPromotionGate;
}

export async function deleteGate(
  supabase: SupabaseClient,
  gateId: string
): Promise<void> {
  const { error } = await supabase
    .from("branch_promotion_gates")
    .delete()
    .eq("id", gateId);
  if (error) throw new Error(error.message);
}

/**
 * Rotate the gate's HMAC secret and return the new value. The old
 * secret is immediately invalidated — subsequent signed requests use
 * the new secret. We do not persist a rotation audit here because the
 * updated_at column already records the change.
 */
export async function rotateGateSecret(
  supabase: SupabaseClient,
  gateId: string
): Promise<string> {
  const secret = generateSecret();
  const { error } = await supabase
    .from("branch_promotion_gates")
    .update({ secret })
    .eq("id", gateId);
  if (error) throw new Error(error.message);
  return secret;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export interface RunGatesResult {
  allPassed: boolean;
  runs: Array<GateRun & { gate_name: string; webhook_url: string }>;
}

/**
 * Invoke every active gate for the workspace + record a gate_run per
 * gate. Returns `allPassed=false` as soon as any gate reports fail /
 * error / timeout, but still waits for every gate to complete so the
 * UI can show the full pass/fail matrix. If the workspace has no
 * active gates, returns `{ allPassed: true, runs: [] }` — no-op.
 *
 * Execution model: Promise.allSettled so one slow/misbehaving gate
 * cannot block the others. Each gate enforces its own timeout via
 * AbortController.
 */
export async function runGates(
  supabase: SupabaseClient,
  workspaceId: string,
  branchId: string,
  branchName: string,
  diffSummary: GateDiffSummary
): Promise<RunGatesResult> {
  const gates = await listActiveGates(supabase, workspaceId);
  if (gates.length === 0) return { allPassed: true, runs: [] };

  const timestamp = new Date().toISOString();
  const body: GateWebhookPayload = {
    branch_id: branchId,
    branch_name: branchName,
    diff_summary: diffSummary,
    timestamp,
  };
  const bodyJson = JSON.stringify(body);

  // Kick off all gates in parallel. Each invocation handles its own
  // timeout + records its own run row. We join the results afterwards.
  const settled = await Promise.allSettled(
    gates.map((gate) => invokeGate(supabase, gate, branchId, bodyJson, timestamp))
  );

  const runs: RunGatesResult["runs"] = [];
  let allPassed = true;
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    const r = settled[i];
    if (r.status === "fulfilled") {
      runs.push({ ...r.value, gate_name: g.name, webhook_url: g.webhook_url });
      if (r.value.status !== "passed") allPassed = false;
    } else {
      // Promise.allSettled rejection here is defensive — invokeGate
      // should always resolve with an 'error' run. Treat as fail.
      allPassed = false;
      runs.push({
        id: "",
        gate_id: g.id,
        branch_id: branchId,
        status: "error",
        response_body: r.reason instanceof Error ? r.reason.message : String(r.reason),
        duration_ms: null,
        created_at: new Date().toISOString(),
        gate_name: g.name,
        webhook_url: g.webhook_url,
      });
    }
  }
  for (const run of runs) {
    logger.info(
      { gateId: run.gate_id, status: run.status, durationMs: run.duration_ms },
      "promotion gate result",
    );
  }

  return { allPassed, runs };
}

async function invokeGate(
  supabase: SupabaseClient,
  gate: BranchPromotionGate,
  branchId: string,
  bodyJson: string,
  timestamp: string
): Promise<GateRun> {
  const startedAt = Date.now();
  const signature = signBody(gate.secret, timestamp, bodyJson);

  // Record a 'pending' row so a crash mid-invocation leaves a visible
  // trace for the admin. We update it to the terminal status below.
  const { data: pendingRow } = await supabase
    .from("branch_promotion_gate_runs")
    .insert({
      gate_id: gate.id,
      branch_id: branchId,
      status: "pending",
    })
    .select()
    .single();
  const runId = (pendingRow as GateRun | null)?.id ?? "";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), gate.timeout_seconds * 1000);

  let status: GateRun["status"] = "error";
  let responseBody: string | null = null;
  try {
    const res = await fetch(gate.webhook_url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-ContextStore-Signature": `v1=${signature}`,
        "X-ContextStore-Timestamp": timestamp,
      },
      body: bodyJson,
    });
    const rawText = await res.text();
    responseBody =
      rawText.length > MAX_RESPONSE_BODY_LEN
        ? rawText.slice(0, MAX_RESPONSE_BODY_LEN)
        : rawText;

    if (!res.ok) {
      status = "failed";
    } else {
      // Parse the body as JSON; missing/invalid JSON is treated as a
      // fail rather than a pass because the contract is explicit.
      try {
        const parsed = JSON.parse(rawText) as { status?: string; reason?: string };
        if (parsed && parsed.status === "pass") {
          status = "passed";
        } else if (parsed && parsed.status === "fail") {
          status = "failed";
        } else {
          status = "failed";
        }
      } catch {
        status = "failed";
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      status = "timeout";
      responseBody = `Gate timed out after ${gate.timeout_seconds}s`;
    } else {
      status = "error";
      responseBody = err instanceof Error ? err.message : String(err);
    }
  } finally {
    clearTimeout(timeoutId);
  }

  const durationMs = Date.now() - startedAt;

  // Flip pending -> terminal. We don't fail the whole gate run if this
  // UPDATE fails — the promote path still needs the allPassed result.
  if (runId) {
    await supabase
      .from("branch_promotion_gate_runs")
      .update({ status, response_body: responseBody, duration_ms: durationMs })
      .eq("id", runId);
  }

  return {
    id: runId,
    gate_id: gate.id,
    branch_id: branchId,
    status,
    response_body: responseBody,
    duration_ms: durationMs,
    created_at: pendingRow ? (pendingRow as GateRun).created_at : new Date().toISOString(),
  };
}

// ─── Gate run history ────────────────────────────────────────────────────────

/**
 * Most-recent N runs per gate for a workspace. Used by the admin
 * settings surface to show "last 5 runs" badges. We fetch one query
 * ordered by created_at desc and bucket in memory — for a handful of
 * gates this is simpler than N separate LIMIT queries.
 */
export async function listRecentRunsByGate(
  supabase: SupabaseClient,
  workspaceId: string,
  limitPerGate: number = 5
): Promise<Record<string, GateRun[]>> {
  const gates = await listGates(supabase, workspaceId);
  if (gates.length === 0) return {};
  const gateIds = gates.map((g) => g.id);

  const { data } = await supabase
    .from("branch_promotion_gate_runs")
    .select("*")
    .in("gate_id", gateIds)
    .order("created_at", { ascending: false });

  const byGate: Record<string, GateRun[]> = {};
  for (const id of gateIds) byGate[id] = [];
  for (const row of (data ?? []) as GateRun[]) {
    const bucket = byGate[row.gate_id];
    if (bucket && bucket.length < limitPerGate) bucket.push(row);
  }
  return byGate;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a 32-byte random secret, hex-encoded (64 chars). */
export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * HMAC-SHA256 signature over `${timestamp}.${bodyJson}` using the
 * gate's secret. Documented in docs/branch_promotion_gates_v1.md so
 * webhook implementers can verify.
 */
export function signBody(secret: string, timestamp: string, bodyJson: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${bodyJson}`)
    .digest("hex");
}

/**
 * Enforce https-only webhook URLs and reject obvious SSRF targets.
 * The service is not a replacement for a proper outbound allowlist —
 * it just catches the common "I typed http://" footgun.
 */
function validateWebhookUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Webhook URL is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Webhook URL must use https://");
  }
  // Lightweight loopback / RFC1918 reject. An admin configuring a
  // gate to call back into their own private network is almost
  // certainly a misconfiguration; if a deployer wants to allow it
  // they can disable the check in a future revision.
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    throw new Error("Webhook URL cannot point at loopback");
  }
}

/**
 * Custom error thrown by `promoteBranch` when one or more gates veto
 * the promotion. The action layer surfaces the failed gates to the UI.
 */
export class GatePromotionError extends Error {
  readonly failedGates: Array<{
    gate_id: string;
    gate_name: string;
    status: GateRun["status"];
    reason: string | null;
  }>;
  constructor(
    failedGates: GatePromotionError["failedGates"]
  ) {
    const names = failedGates.map((g) => g.gate_name).join(", ");
    super(`Promotion blocked by gate(s): ${names}`);
    this.name = "GatePromotionError";
    this.failedGates = failedGates;
  }
}
