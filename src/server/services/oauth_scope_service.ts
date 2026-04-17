/**
 * OAuth scopes for Context Store MCP / canonical API access.
 *
 * Each scope is a product-level capability: what the external client
 * is allowed to do inside a workspace once the user has consented.
 * Scopes compose — a connector that only needs to read context doesn't
 * have to accept a scope it won't use, and viewers can't consent to a
 * scope their role cannot fulfil.
 *
 * Two scope families are supported:
 *
 *   1. Capability scopes ("context:read", "context:search",
 *      "context:bundles", "context:propose", "context:generate"):
 *      declare WHAT the token can do. These are the canonical ones
 *      connectors request.
 *
 *   2. Resource narrowing scopes ("context:box:<uuid>"): optionally
 *      declare WHICH boxes the token can touch. Presence of ANY
 *      `context:box:<uuid>` scope on a grant restricts the token to
 *      that set of boxes — all capability scopes take effect only on
 *      those boxes. Absence means "workspace-wide" for backward
 *      compatibility.
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
 *   5. Box-scope restrictions are additive to workspace membership —
 *      a token cannot reach a box the user itself cannot reach.
 */

export type OAuthCapabilityScope =
  | "context:read"
  | "context:search"
  | "context:bundles"
  | "context:propose"
  | "context:generate"
  | "context:branch";

/**
 * A box-narrowing scope. The full scope string is `context:box:<uuid>`;
 * the `OAuthBoxScope` type is the string literal template so callers
 * and TypeScript can recognise it.
 */
export type OAuthBoxScope = `context:box:${string}`;

export type OAuthScope = OAuthCapabilityScope | OAuthBoxScope;

export const OAUTH_SCOPES: Record<OAuthCapabilityScope, { label: string; description: string; minRole: "viewer" | "member" | "admin" }> = {
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
  "context:branch": {
    label: "Create and write to branches",
    description:
      "Create draft branches and batch-write notes onto them for human review. Branch content does not touch main until a human promotes it.",
    minRole: "member",
  },
};

/** Every capability scope the server recognises. Box scopes are dynamic. */
export const ALL_SCOPES: OAuthCapabilityScope[] = Object.keys(OAUTH_SCOPES) as OAuthCapabilityScope[];

const BOX_SCOPE_PATTERN =
  /^context:box:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Is this a capability scope (context:read, etc.)? */
export function isCapabilityScope(s: string): s is OAuthCapabilityScope {
  return (ALL_SCOPES as readonly string[]).includes(s);
}

/** Is this a `context:box:<uuid>` narrowing scope? */
export function isBoxScope(s: string): s is OAuthBoxScope {
  return BOX_SCOPE_PATTERN.test(s);
}

/** Extract the box_id from a `context:box:<uuid>` scope. Null if not a box scope. */
export function parseBoxScope(s: string): string | null {
  if (!isBoxScope(s)) return null;
  return s.slice("context:box:".length);
}

/** Build a `context:box:<uuid>` scope string. */
export function buildBoxScope(boxId: string): OAuthBoxScope {
  return `context:box:${boxId}` as OAuthBoxScope;
}

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
    if (isCapabilityScope(raw)) seen.add(raw);
    else if (isBoxScope(raw)) seen.add(raw);
  }
  return Array.from(seen);
}

export function serializeScopes(scopes: OAuthScope[]): string {
  return scopes.join(" ");
}

/**
 * Split a scope list into (capabilityScopes, boxIds). boxIds is null
 * when no box-narrowing scope is present (meaning workspace-wide).
 * Used by token verifiers and MCP handlers to decide enforcement.
 */
export function splitScopes(scopes: OAuthScope[]): {
  capabilities: OAuthCapabilityScope[];
  boxIds: Set<string> | null;
} {
  const capabilities: OAuthCapabilityScope[] = [];
  const boxIds = new Set<string>();
  for (const s of scopes) {
    if (isCapabilityScope(s)) capabilities.push(s);
    else {
      const id = parseBoxScope(s);
      if (id) boxIds.add(id);
    }
  }
  return { capabilities, boxIds: boxIds.size > 0 ? boxIds : null };
}

/**
 * Given the scopes a client requested, the scopes the client is allowed
 * to use, and the caller's workspace role, return the concrete scope
 * set that should be granted — or a non-empty error string explaining
 * what's wrong.
 *
 * Notes:
 *
 *   - For CAPABILITY scopes we intersect against `clientAllowed`. A
 *     client must have the capability in its registration.
 *   - For BOX scopes, we do NOT require the client to pre-register
 *     box ids; a registered client that can do `context:read` inherits
 *     the ability to be narrowed to any box the user consents to.
 *     This keeps client registration box-agnostic and matches how
 *     users expect the consent UI to work.
 *   - Role gating: capability scopes are compared against `minRole`.
 *     Box scopes have no role gate — they narrow, never broaden, so
 *     attaching them is always safe.
 */
export function resolveGrantedScopes(input: {
  requested: OAuthScope[];
  clientAllowed: OAuthCapabilityScope[];
  role: "owner" | "admin" | "member" | "viewer";
  /** Every box the user has access to in the target workspace. */
  accessibleBoxIds?: Set<string>;
}): { ok: true; scopes: OAuthScope[] } | { ok: false; error: string } {
  const { capabilities, boxIds } = splitScopes(input.requested);

  const allowedSet = new Set(input.clientAllowed);
  const unknownForClient = capabilities.filter((s) => !allowedSet.has(s));
  if (unknownForClient.length > 0) {
    return {
      ok: false,
      error: `Client is not allowed to request: ${unknownForClient.join(", ")}`,
    };
  }

  const blockedByRole = capabilities.filter(
    (s) => !roleCanGrant(input.role, OAUTH_SCOPES[s].minRole)
  );
  if (blockedByRole.length > 0) {
    return {
      ok: false,
      error: `Your role (${input.role}) cannot grant: ${blockedByRole.join(", ")}`,
    };
  }

  // If the caller passed an `accessibleBoxIds` set, reject any
  // box-scope the user doesn't actually have access to. This prevents
  // a user from granting a connector access to a box they themselves
  // cannot reach, even though the scope format would allow it.
  if (boxIds && input.accessibleBoxIds) {
    const unreachable: string[] = [];
    for (const id of boxIds) {
      if (!input.accessibleBoxIds.has(id)) unreachable.push(id);
    }
    if (unreachable.length > 0) {
      return {
        ok: false,
        error: `You do not have access to boxes: ${unreachable.join(", ")}`,
      };
    }
  }

  return { ok: true, scopes: input.requested };
}

/**
 * Runtime capability scope check. Accepts either an array or a
 * space-separated string (as stored in the DB). Only capability
 * scopes are matched here — box scopes are enforced separately via
 * `splitScopes(...).boxIds`.
 */
export function hasScope(granted: OAuthScope[] | string, required: OAuthCapabilityScope): boolean {
  const list = Array.isArray(granted) ? granted : parseScopeString(granted);
  return list.includes(required);
}

/**
 * Return true if this token may access the given box. A token with no
 * box scopes has workspace-wide access; a token with box scopes is
 * restricted to that set.
 */
export function canAccessBox(granted: OAuthScope[] | string, boxId: string): boolean {
  const list = Array.isArray(granted) ? granted : parseScopeString(granted);
  const { boxIds } = splitScopes(list);
  if (!boxIds) return true;
  return boxIds.has(boxId);
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
