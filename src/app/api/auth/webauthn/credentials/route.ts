import { getRequestContext } from "@/server/auth/get_request_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteCredential } from "@/server/services/webauthn_service";

export const runtime = "nodejs";

/**
 * DELETE /api/auth/webauthn/credentials
 *
 * Removes a registered passkey credential. Requires authentication.
 *
 * Body: { credentialId: string }  (the row UUID, not the WebAuthn credentialId)
 */
export async function DELETE(request: Request) {
  const ctx = await getRequestContext();

  if (!ctx.isAuthenticated || !ctx.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { credentialId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.credentialId) {
    return Response.json(
      { error: "Missing credentialId" },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    await deleteCredential(supabase, body.credentialId, ctx.user.id);
    return Response.json({ deleted: true });
  } catch (err) {
    console.error("[webauthn/credentials DELETE]", err);
    return Response.json(
      { error: "Failed to delete credential" },
      { status: 500 },
    );
  }
}
