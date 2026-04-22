"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import {
  listSessionsByWorkspace,
  getBrowsingSessionById,
  listStepsBySession,
} from "@/server/repositories/browsing_session_repository";
import { getCurrentMonthSpendCents } from "@/server/repositories/web_tool_usage_repository";
import { listCitationsByRun } from "@/server/repositories/web_citation_repository";
import type {
  BrowsingSession,
  BrowsingSessionStep,
  WebCitation,
} from "@/server/domain/types/web_tool";

export type ListSessionsResult =
  | { ok: true; data: BrowsingSession[] }
  | { ok: false; error: string };

export async function listBrowsingSessionsAction(
  limit = 50
): Promise<ListSessionsResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const data = await listSessionsByWorkspace(supabase, ctx.workspace.id, {
      limit,
    });
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load sessions",
    };
  }
}

export type SessionDetailResult =
  | {
      ok: true;
      data: {
        session: BrowsingSession;
        steps: BrowsingSessionStep[];
      };
    }
  | { ok: false; error: string };

export async function getSessionWithStepsAction(
  sessionId: string
): Promise<SessionDetailResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const session = await getBrowsingSessionById(supabase, sessionId);
    if (!session) return { ok: false, error: "Session not found" };
    if (session.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Not authorised" };
    }
    const steps = await listStepsBySession(supabase, sessionId);
    return { ok: true, data: { session, steps } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load session",
    };
  }
}

export interface WebBudgetStatus {
  current_cents: number;
  budget_cents: number;
  percent_used: number;
}

export type WebBudgetStatusResult =
  | { ok: true; data: WebBudgetStatus }
  | { ok: false; error: string };

export async function getWebBudgetStatusAction(): Promise<WebBudgetStatusResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const admin = createAdminClient();
    const [current, { data: ws }] = await Promise.all([
      getCurrentMonthSpendCents(admin, ctx.workspace.id),
      admin
        .from("workspaces")
        .select("web_tool_budget_cents")
        .eq("id", ctx.workspace.id)
        .single(),
    ]);
    const budget = (ws?.web_tool_budget_cents as number | undefined) ?? 500;
    const percent_used = budget > 0 ? Math.min(100, (current / budget) * 100) : 0;
    return {
      ok: true,
      data: {
        current_cents: current,
        budget_cents: budget,
        percent_used,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load budget",
    };
  }
}

export type ListCitationsResult =
  | { ok: true; data: WebCitation[] }
  | { ok: false; error: string };

export async function listCitationsForRunAction(
  operatorRunId: string
): Promise<ListCitationsResult> {
  try {
    await requireAuthenticatedUser();
    const supabase = await createClient();
    const data = await listCitationsByRun(supabase, operatorRunId);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load citations",
    };
  }
}
