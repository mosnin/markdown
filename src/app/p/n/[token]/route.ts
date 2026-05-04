import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  redeemPullToken,
  lookupPullTokenIdByString,
} from "@/server/services/pull_token_service";
import { assembleContextBundle } from "@/server/services/context_bundle_service";
import {
  hydrateBundleBodies,
  renderBundleMarkdown,
} from "@/server/services/context_bundle_markdown";
import { getWorkspaceById } from "@/server/repositories/workspace_repository";
import {
  auditBundlePulled,
  auditBundlePulledInvalid,
} from "@/server/services/audit_service";

/**
 * GET `/p/n/[token]` — content-negotiated pull-token redemption.
 *
 * Resolution rules:
 *   - `Accept: text/markdown` OR a path ending in `.md` → markdown bundle
 *   - `Accept: application/json` → JSON bundle (raw ContextBundle)
 *   - anything else → minimal HTML share-page placeholder
 *
 * Successful responses include:
 *   - `X-Poggle-Expires-At`  : ISO timestamp of new expiry
 *   - `X-Poggle-Expires-In`  : seconds until expiry
 *   - `Cache-Control: no-store`
 *
 * v1 only supports `object_type === "note"`. For any other type, returns
 * 415 with `{ error: "object_type not yet supported by pull-token bundles" }`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params;
  // Strip a possible `.md` suffix BEFORE redemption — the suffix is a
  // content-negotiation hint, not part of the secret.
  const wantMdFromPath = token.endsWith(".md");
  const rawToken = wantMdFromPath ? token.slice(0, -3) : token;

  const userAgent = request.headers.get("user-agent");
  const admin = createAdminClient();

  const result = await redeemPullToken(admin, rawToken, userAgent);
  if (!result) {
    // Best-effort audit. We don't always have a workspace to attribute
    // the failure to — pass null in that case.
    auditBundlePulledInvalid(admin, null, {
      token_prefix: rawToken.slice(0, 16),
      user_agent: userAgent,
      reason: "expired_or_unknown",
    });
    return new Response("Expired or invalid", { status: 401 });
  }

  // ── Object-type guard ────────────────────────────────────────────────────
  if (result.objectType !== "note") {
    return Response.json(
      { error: "object_type not yet supported by pull-token bundles" },
      { status: 415 }
    );
  }

  // ── Content-negotiation flags ────────────────────────────────────────────
  const accept = request.headers.get("accept") ?? "";
  const wantMd = wantMdFromPath || accept.includes("text/markdown");
  const wantJson = !wantMd && accept.includes("application/json");

  // ── Assemble the bundle ──────────────────────────────────────────────────
  let bundle;
  try {
    bundle = await assembleContextBundle(admin, result.workspaceId, result.objectId, {
      userId: result.userId,
      includeUserBranches: true,
    });
  } catch (err) {
    logger.error({ err, noteId: result.objectId }, "pull-token bundle assembly failed");
    return Response.json(
      { error: "Failed to assemble bundle for note" },
      { status: 500 }
    );
  }

  // ── Audit + token id lookup (best-effort, never blocks the response) ────
  const tokenId = await lookupPullTokenIdByString(admin, rawToken);
  auditBundlePulled(admin, result.workspaceId, result.userId, result.objectId, {
    token_id: tokenId,
    object_type: result.objectType,
    object_id: result.objectId,
    user_agent: userAgent,
    mode: "read",
  });

  const headers: Record<string, string> = {
    "X-Poggle-Expires-At": result.newExpiresAt,
    "X-Poggle-Expires-In": String(result.expiresInSeconds),
    "Cache-Control": "no-store",
  };

  // ── Markdown branch ──────────────────────────────────────────────────────
  if (wantMd) {
    const workspace = await getWorkspaceById(admin, result.workspaceId);
    const bodiesById = await hydrateBundleBodies(admin, bundle);
    const markdown = renderBundleMarkdown({
      bundle,
      workspaceName: workspace?.name ?? "",
      expiresAt: result.newExpiresAt,
      bodiesById,
    });
    return new Response(markdown, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "text/markdown; charset=utf-8",
      },
    });
  }

  // ── JSON branch ──────────────────────────────────────────────────────────
  if (wantJson) {
    return Response.json(bundle, { status: 200, headers });
  }

  // ── HTML fallback ───────────────────────────────────────────────────────
  // Pull-tokens are AI-first surfaces; we don't reuse the share-token
  // page here (different system, different RLS contract). A minimal
  // self-explanatory page is enough.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Poggle pull-link · ${escapeHtml(bundle.target_note.title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; color: #222; }
  h1 { font-size: 1.5rem; margin-top: 0; }
  code { background: #f4f4f5; padding: 0.1rem 0.3rem; border-radius: 0.25rem; font-size: 0.9em; }
  .meta { color: #666; font-size: 0.9rem; }
  .note { border-left: 3px solid #0070f3; padding: 0.75rem 1rem; background: #f7faff; margin-top: 1.5rem; border-radius: 0.25rem; }
</style>
</head>
<body>
  <p class="meta">Poggle pull-link</p>
  <h1>${escapeHtml(bundle.target_note.title)}</h1>
  <p>This is a pull-link for the note above. The AI agent that opened this URL should be reading the markdown variant.</p>
  <div class="note">
    <p>To pull this bundle as markdown, request the same URL with <code>Accept: text/markdown</code> or append <code>.md</code> to the path.</p>
    <p>To view this note as a regular HTML page, ask the workspace owner for a share link.</p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
