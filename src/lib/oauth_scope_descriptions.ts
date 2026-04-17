/**
 * Plain-English descriptions + visual grouping for OAuth scopes.
 *
 * The authorize page and the Connected Apps settings page both need
 * human-friendly copy for each scope. Co-locating it here ensures the
 * two surfaces never drift: when a new capability scope is added to
 * `oauth_scope_service`, the unit test in
 * `src/tests/unit/oauth_scope_descriptions.test.ts` fails until we add
 * its description here.
 *
 * Box-narrowing scopes (`context:box:<uuid>`) are handled specially —
 * we don't hard-code the uuid; the consuming UI resolves the box name
 * from the database and passes it through {@link describeBoxScope}.
 *
 * Keep the copy product-y, not legalese:
 *   - "safe"          — read-only, nothing persists.
 *   - "propose-write" — creates a proposal for human review; no direct write.
 *   - "generate"      — writes directly into allowed folders.
 *
 * The badge variant maps to existing UI primitives (`success`, `warning`,
 * `error`) so the consent screen inherits the app palette.
 */

import type {
  OAuthCapabilityScope,
  OAuthScope,
} from "@/server/services/oauth_scope_service";
import {
  ALL_SCOPES,
  isBoxScope,
  isCapabilityScope,
  parseBoxScope,
} from "@/server/services/oauth_scope_service";

export type ScopeRiskTier = "safe" | "propose-write" | "generate";

export type ScopeGroup = "read" | "propose" | "generate" | "branch";

export interface ScopeDescription {
  /** Canonical scope string, e.g. "context:read". */
  scope: OAuthCapabilityScope;
  /** Short verb-first title suitable for a list row. */
  title: string;
  /** One-to-two-sentence plain-English summary of what the scope permits. */
  description: string;
  /** Grouping used for the consent UI's visual sectioning. */
  group: ScopeGroup;
  /** Coarse risk tier — drives badge color and warning copy. */
  tier: ScopeRiskTier;
  /** Whether the scope can result in any mutation (direct or proposed). */
  writeCapable: boolean;
  /** shadcn/ui Badge variant name. */
  badgeVariant: "success" | "warning" | "error" | "info";
}

export const SCOPE_DESCRIPTIONS: Record<OAuthCapabilityScope, ScopeDescription> = {
  "context:read": {
    scope: "context:read",
    title: "Read your workspace content",
    description:
      "View notes, files, folders, boxes, skills, and agents in the workspace. No changes are made.",
    group: "read",
    tier: "safe",
    writeCapable: false,
    badgeVariant: "success",
  },
  "context:search": {
    scope: "context:search",
    title: "Search across your content",
    description:
      "Run full-text search over notes and files, and read back the matches. Read-only.",
    group: "read",
    tier: "safe",
    writeCapable: false,
    badgeVariant: "success",
  },
  "context:bundles": {
    scope: "context:bundles",
    title: "Assemble context bundles",
    description:
      "Fetch the deterministic context bundle used to brief AI agents. Read-only.",
    group: "read",
    tier: "safe",
    writeCapable: false,
    badgeVariant: "success",
  },
  "context:propose": {
    scope: "context:propose",
    title: "Propose changes for review",
    description:
      "Submit write proposals (new notes, edits, attachments) for a human to approve before anything is saved.",
    group: "propose",
    tier: "propose-write",
    writeCapable: true,
    badgeVariant: "warning",
  },
  "context:generate": {
    scope: "context:generate",
    title: "Generate content in allowed folders",
    description:
      "Write notes directly into folders that are explicitly marked as accepting generated content. Reusable skills and agents still require proposals.",
    group: "generate",
    tier: "generate",
    writeCapable: true,
    badgeVariant: "error",
  },
  "context:branch": {
    scope: "context:branch",
    title: "Create and write to branches",
    description:
      "Create draft branches and batch-write notes onto them for human review. Branch content does not touch main until a human promotes it.",
    group: "branch",
    tier: "propose-write",
    writeCapable: true,
    badgeVariant: "warning",
  },
};

/** Human-readable label for a group header in the consent UI. */
export const SCOPE_GROUP_LABELS: Record<ScopeGroup, string> = {
  read: "Read",
  propose: "Propose writes",
  generate: "Generate",
  branch: "Branch",
};

/** Returns true if the capability-scope set contains at least one writer. */
export function anyWriteCapable(scopes: readonly OAuthScope[]): boolean {
  for (const s of scopes) {
    if (isCapabilityScope(s) && SCOPE_DESCRIPTIONS[s].writeCapable) {
      return true;
    }
  }
  return false;
}

/**
 * Describe a single scope — capability or box. For box scopes the
 * caller must pass the resolved box name (from the database); we
 * return a generic "access to a specific box" fallback if not.
 */
export function describeScope(
  scope: OAuthScope,
  boxNameLookup?: (boxId: string) => string | null
): {
  title: string;
  description: string;
  group: ScopeGroup | "narrow";
  tier: ScopeRiskTier | "narrow";
  writeCapable: boolean;
  badgeVariant: "success" | "warning" | "error" | "info";
} {
  if (isCapabilityScope(scope)) {
    const desc = SCOPE_DESCRIPTIONS[scope];
    return {
      title: desc.title,
      description: desc.description,
      group: desc.group,
      tier: desc.tier,
      writeCapable: desc.writeCapable,
      badgeVariant: desc.badgeVariant,
    };
  }
  if (isBoxScope(scope)) {
    const boxId = parseBoxScope(scope);
    const name = boxId && boxNameLookup ? boxNameLookup(boxId) : null;
    return {
      title: name ? `Limit access to box "${name}"` : "Limit access to a specific box",
      description:
        "Restricts the connector so it can only touch the listed box(es). This narrows access — it does not grant new permissions.",
      group: "narrow",
      tier: "narrow",
      writeCapable: false,
      badgeVariant: "info",
    };
  }
  // Defensive — unknown shape shouldn't reach this function.
  return {
    title: scope,
    description: "Unknown scope.",
    group: "narrow",
    tier: "narrow",
    writeCapable: false,
    badgeVariant: "info",
  };
}

/** Pretty label for a box scope, used by the Connected Apps list. */
export function describeBoxScope(boxId: string, boxName: string | null) {
  return {
    title: boxName ? `Box: ${boxName}` : `Box: ${boxId.slice(0, 8)}…`,
    description:
      "Access is limited to this box. The connector cannot read or write outside of it.",
    badgeVariant: "info" as const,
  };
}

/**
 * Group the scopes in a request by their UI section. Box scopes land in
 * a separate `narrow` bucket that the consent UI renders as a "the
 * connector asked for these specific boxes" note.
 */
export function groupScopes(scopes: readonly OAuthScope[]): {
  read: OAuthCapabilityScope[];
  propose: OAuthCapabilityScope[];
  generate: OAuthCapabilityScope[];
  branch: OAuthCapabilityScope[];
  narrow: string[];
} {
  const read: OAuthCapabilityScope[] = [];
  const propose: OAuthCapabilityScope[] = [];
  const generate: OAuthCapabilityScope[] = [];
  const branch: OAuthCapabilityScope[] = [];
  const narrow: string[] = [];
  for (const s of scopes) {
    if (isCapabilityScope(s)) {
      const g = SCOPE_DESCRIPTIONS[s].group;
      if (g === "read") read.push(s);
      else if (g === "propose") propose.push(s);
      else if (g === "branch") branch.push(s);
      else generate.push(s);
    } else if (isBoxScope(s)) {
      const id = parseBoxScope(s);
      if (id) narrow.push(id);
    }
  }
  return { read, propose, generate, branch, narrow };
}

/**
 * Sanity-check used by the unit test: every capability scope registered
 * in `oauth_scope_service` must have a corresponding description here.
 */
export function assertEveryScopeDescribed(): void {
  for (const s of ALL_SCOPES) {
    if (!SCOPE_DESCRIPTIONS[s]) {
      throw new Error(`Missing scope description for ${s}`);
    }
  }
}
