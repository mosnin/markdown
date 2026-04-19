import { type NextRequest, NextResponse } from "next/server";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/agent/tools/progress
 *
 * Internal endpoint invoked by the Workspace Operator (Modal Python agent)
 * during plan execution. Each call represents a progress event (step started,
 * step completed, tool call made, etc.) that gets broadcast to the browser
 * via Supabase Realtime on a per-run channel.
 *
 * Body: { run_id: string, type: string, step_index?: number, detail?: string,
 *         timestamp?: string }
 *
 * This endpoint uses the admin (service-role) Supabase client because the
 * caller is Modal, not a logged-in user.
 */
export async function POST(request: NextRequest) {
  const auth = verifyAgentRequest(request);
  if (!auth.ok) {
    const status = auth.failure.kind === "invalid_secret" ? 403 : 400;
    return NextResponse.json(
      {
        error_code: auth.failure.kind,
        message: `Auth failed: ${auth.failure.kind}`,
      },
      { status }
    );
  }

  let body: {
    run_id: string;
    type: string;
    step_index?: number;
    detail?: string;
    timestamp?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error_code: "invalid_body", message: "Invalid JSON" },
      { status: 400 }
    );
  }

  if (!body.run_id || !body.type) {
    return NextResponse.json(
      {
        error_code: "missing_fields",
        message: "run_id and type are required",
      },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const channelName = `operator_run:${body.run_id}`;

  await supabase.channel(channelName).send({
    type: "broadcast",
    event: "progress",
    payload: {
      run_id: body.run_id,
      type: body.type,
      step_index: body.step_index ?? null,
      detail: body.detail ?? null,
      timestamp: body.timestamp ?? new Date().toISOString(),
    },
  });

  return NextResponse.json(
    { data: { received: true }, meta: { request_id: auth.ctx.runId } },
    { status: 200 }
  );
}
