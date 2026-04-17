import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { getSystemGuide } from "@/server/services/system_guide_service";
import { apiOk, E_UNAUTHORIZED, E_INSUFFICIENT_SCOPE } from "@/lib/api/response";

/**
 * GET /api/v1/system_guide
 *
 * Returns the static system guide describing Context Store's data
 * model, entity definitions, relationship types, retrieval rules, and
 * write rules.
 *
 * Auth: OAuth access token with `context:read` scope. Legacy csk_v1_
 * tokens are accepted when the env flag is on and short-circuit the
 * scope gate.
 */
export async function GET(request: NextRequest) {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:read")) {
    return E_INSUFFICIENT_SCOPE("context:read");
  }

  const guide = getSystemGuide();
  const res = apiOk(guide);
  // The system guide is static reference content — cache aggressively at the
  // edge and let stale copies serve while revalidating in the background.
  res.headers.set(
    "Cache-Control",
    "public, s-maxage=3600, stale-while-revalidate=86400",
  );
  return res;
}
