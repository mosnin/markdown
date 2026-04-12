/**
 * OAuth scopes for Context Store MCP / canonical API access.
 *
 * Each scope is a product-level capability: what the external client
 * is allowed to do inside a workspace once the user has consented.
 * Scopes compose — a connector that only needs to read context doesn't
 * have to accept a scope it won't use, and viewers can't consent to a
 * scope their role cannot fulfil.
 *
 * Design rules:
 *
 *   1. Scopes map 1:1 to existing product capability boundaries
 *      (workspace role, connection permission_mode, folder policies).
 *   2. No "admin" or "*" scope. Admin operations are out of MCP scope
 *      for V1 — membership changes and workspace settings stay on the
 *      human UI and use session auth, not connector tokens.
 *   3. Scope checks are server-enforced at every MCP and canonical-API
 *      entry point. A token that was granted only `context:read`
 *      cannot call a write tool even if the underlying permission
 *      allows it.
 *   4. Scopes do not override workspace role. A viewer's access token
 *      carrying `context:generate` still cannot write — role gating
 *      runs after scope gating.
 */

export type OAuthScope =
  | "context:read"
  | "context:search"
  | "context:bundles"
  | "context:propose"
  | "context:generate";

export const OAUTH_SCOPES: Record<OAuthScope, { label: string; description: string; minRole: "viewer" | "member" | "admin" }> = {
  "context:read": {
    label: "Read context",
    description: "List boxes and folders, read notes, files, skills, and agents.",
    minRole: "viewer",
  },
  "context:search": {
    label: "Search and discover",
    description: "Search across notes and files, and read search results.",
    minRole: "viewer",
  },
  "context:bundles": {
    label: "Assemble context bundles",
    description: "Fetch the deterministic context bundle used by other AI agents.",
    minRole: "viewer",
  },
  "context:propose": {
    label: "Propose changes",
    description: "Submit write proposals for human review. Cannot modify content directly.",
    minRole: "member",
  },
  "context:generate": {
    label: "Generate in allowed folders",
    description:
      "Write notes directly into folders that are explicitly marked as accepting generated content. Reusable skills and agents still require proposals.",
    minRole: "member",
  },
};

/** Every scope the server recognises. Clients may only request from this list. */
export const ALL_SCOPES: OAuthScope[] = Object.keys(OAUTH_SCOPES) as OAuthScope[];

/**
 * Parse a space-separated scope string into a validated scope array.
 * Unknown scopes are dropped (callers should reject the request up-front
 * via `validateRequestedScopes` if they want strict mode).
 */
export function parseScopeString(scope: string | null | undefined): OAuthScope[] {
  if (!scope) return [];
  const seen = new Set<OAuthScope>();
  for (const raw of scope.split(/\s+/)) {
    if (!raw) continue;
    if (raw in OAUTH_SCOPES) seen.add(raw as OAuthScope);
  }
  return Array.from(seen);
}

export function serializeScopes(scopes: OAuthScope[]): string {
  return scopes.join(" ");
}

/**
 * Given the scopes a client requested, the scopes the client is allowed
 * to use, and the caller's workspace role, return the concrete scope
 * set that should be granted — or a non-empty error string explaining
 * what's wrong.
 */
export function resolveGrantedScopes(input: {
  requested: OAuthScope[];
  clientAllowed: OAuthScope[];
  role: "owner" | "admin" | "member" | "viewer";
}): { ok: true; scopes: OAuthScope[] } | { ok: false; error: string } {
  const allowedSet = new Set(input.clientAllowed);
  const unknownForClient = input.requested.filter((s) => !allowedSet.has(s));
  if (unknownForClient.length > 0) {
    return {
      ok: false,
      error: `Client is not allowed to request: ${unknownForClient.join(", ")}`,
    };
  }

  // Role gating. A viewer can only consent to read-level scopes; any
  // request for write-level scopes by a viewer is rejected so we don't
  // silently downgrade or surprise the user.
  const blockedByRole = input.requested.filter(
    (s) => !roleCanGrant(input.role, OAUTH_SCOPES[s].minRole)
  );
  if (blockedByRole.length > 0) {
    return {
      ok: false,
      error: `Your role (${input.role}) cannot grant: ${blockedByRole.join(", ")}`,
    };
  }

  return { ok: true, scopes: input.requested };
}

/** Runtime scope check — used by MCP tool handlers and API routes. */
export function hasScope(granted: OAuthScope[] | string, required: OAuthScope): boolean {
  const list = Array.isArray(granted) ? granted : parseScopeString(granted);
  return list.includes(required);
}

/** Compare roles: is `have` at least `need`? */
function roleCanGrant(
  have: "owner" | "admin" | "member" | "viewer",
  need: "viewer" | "member" | "admin"
): boolean {
  const order = { viewer: 0, member: 1, admin: 2, owner: 3 } as const;
  const needOrder = { viewer: 0, member: 1, admin: 2 } as const;
  return order[have] >= needOrder[need];
}
