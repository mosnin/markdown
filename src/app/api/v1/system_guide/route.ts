import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { getSystemGuide } from "@/server/services/system_guide_service";
import { apiOk, E_UNAUTHORIZED } from "@/lib/api/response";

/**
 * GET /api/v1/system_guide
 *
 * Returns the static system guide describing Context Store's data model,
 * entity definitions, relationship types, retrieval rules, and write rules.
 *
 * Useful for AI clients that need to orient themselves before making
 * other API calls.
 */
export async function GET(request: NextRequest) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  const guide = getSystemGuide();
  return apiOk(guide);
}
