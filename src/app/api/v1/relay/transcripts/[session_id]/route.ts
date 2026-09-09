import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRelayAuth } from "@/server/auth/relay_auth";
import { withApiHandler } from "@/server/api/with_api_handler";
import {
  apiOk,
  E_INSUFFICIENT_SCOPE,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import { readTranscriptWindow } from "@/server/services/transcript_service";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ session_id: string }>;
}

/**
 * GET /api/v1/relay/transcripts/[session_id]?around=<ordinal>&radius=<n>
 *
 * Read the conversation around a point.
 *
 * The necessary other half of search: a matching paragraph on its own is rarely
 * enough to act on. What made the last agent abandon an approach is usually
 * spread across the prompt that led into it, the reasoning, and the tool result
 * that came back — so an agent that finds a hit needs to read around it.
 *
 * Query parameters:
 *   around  centre the window on this ordinal (from a search hit)
 *   radius  segments either side, default 6, max 30
 *   from    alternatively, read forward from this ordinal
 *   limit   max segments returned, default radius*2+1, max 100
 *
 * Auth: relay key, or OAuth token with `relay:read`.
 */
export const GET = withApiHandler(async (request: NextRequest, ctxParams) => {
  const auth = await resolveRelayAuth(request);
  if (!auth) return E_UNAUTHORIZED();
  if (!auth.canRead) return E_INSUFFICIENT_SCOPE("relay:read");

  const { session_id } = await (ctxParams as RouteParams).params;
  const url = new URL(request.url);

  const numeric = (name: string): number | undefined => {
    const raw = url.searchParams.get(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };

  const admin = createAdminClient();
  const window = await readTranscriptWindow(
    admin,
    auth.workspaceId,
    session_id,
    {
      around: numeric("around"),
      radius: numeric("radius"),
      from: numeric("from"),
      limit: numeric("limit"),
    }
  );

  return apiOk(window);
});
