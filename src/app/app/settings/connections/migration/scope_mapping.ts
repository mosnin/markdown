import type { PermissionMode } from "@/server/domain/constants/connection_constants";
import type { OAuthCapabilityScope } from "@/server/services/oauth_scope_service";

/**
 * Map a legacy connection permission_mode to the equivalent OAuth
 * capability scopes. Used by the migration wizard to pre-fill the
 * OAuth client registration.
 *
 * This is NOT in the `actions.ts` file because `"use server"` modules
 * only export async functions (server actions). A synchronous pure
 * function must live in a separate module so client components can
 * import it directly.
 */
export function permissionModeToScopes(
  mode: PermissionMode
): OAuthCapabilityScope[] {
  switch (mode) {
    case "read_only":
      return ["context:read", "context:search", "context:bundles"];
    case "propose_writes":
      return [
        "context:read",
        "context:search",
        "context:bundles",
        "context:propose",
      ];
    case "generate_in_allowed_folders":
      return [
        "context:read",
        "context:search",
        "context:bundles",
        "context:propose",
        "context:generate",
      ];
    default:
      return ["context:read", "context:search", "context:bundles"];
  }
}
