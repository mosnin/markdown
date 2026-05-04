/**
 * Typed feature-flag shim.
 *
 * Single source of truth for product-tier gating. Every flag is read from
 * `process.env.NEXT_PUBLIC_FEATURE_*` so the same value is observed during
 * the SSR pass and on the client — without this, hydration would mismatch
 * any UI branched on a feature flag.
 *
 * Defaults are picked so that:
 *   - The default tier renders a focused ~30-page surface (Notes / Boxes /
 *     Agents / Bundles / Search / Settings + the conversational backbone).
 *   - Power users / enterprise tier flip a single env var to expose every
 *     legacy "secondary" surface.
 *
 * Reversible in one config flip: set `NEXT_PUBLIC_FEATURE_ADVANCED_SURFACES=true`
 * to bring every gated route back.
 *
 * ─── Flag inventory ────────────────────────────────────────────────────
 *
 *   advanced_surfaces — gates the full secondary product surface area:
 *     routes:
 *       /app/sub_agents              (and /sub_agents/[invocation_id])
 *       /app/web_sessions            (and /web_sessions/[session_id])
 *       /app/workspace_operator      (standalone history page only)
 *       /app/analytics
 *       /app/audit
 *       /app/insights
 *       /app/usage
 *       /app/branches                (and /branches/[branch_id])
 *       /app/workflows               (and /workflows/[workflow_id]/**, /templates)
 *       /app/graph
 *       /app/entities/[entity_id]
 *     components:
 *       AppSidebar — Build (Workflows, Branches), Explore (Knowledge Graph)
 *       MobileSidebar — same items as AppSidebar
 *
 *   operator_on_home — when true, surfaces the Workspace Operator entry
 *     point on the /app home dashboard. Kept on by default so the agent
 *     remains discoverable even when `advanced_surfaces` is off (Move 5
 *     promotes the operator's primary surface to /app).
 *     components: home dashboard hero, command palette quick action.
 *
 *   enterprise_sso — when true, exposes the SAML / OIDC SSO configuration
 *     UI in workspace settings. Default-on because the wiring is enterprise-
 *     tier safe (admin-gated server actions); the flag exists to allow a
 *     fast kill switch if the SSO surface needs to be hidden.
 *     components: settings → security tab, sign-in page IdP picker.
 */

// ─── Source-of-truth env reader ──────────────────────────────────────────────
//
// `process.env.NEXT_PUBLIC_*` is statically inlined by Next.js at build time
// for client bundles, so this works identically in server and client code.
// We accept the canonical "true" / "false" / "1" / "0" literals.

function readEnvFlag(envKey: string, fallback: boolean): boolean {
  const raw = process.env[envKey];
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return fallback;
}

// ─── Public flag map ─────────────────────────────────────────────────────────
//
// Stable export shape. Add new flags here and wire them up in the JSDoc
// inventory above. Defaults are the production defaults — the dev .env.local
// flips `advanced_surfaces=true` so local development sees the full surface.

/**
 * Frozen map of every product feature flag. Read at module load so server
 * components and client components observe the same boolean for the same
 * request (Next.js inlines `NEXT_PUBLIC_*` at build time).
 */
export const FEATURE_FLAGS = {
  /**
   * Gates the secondary product surface (sub-agents, web sessions, audit,
   * analytics, insights, usage, branches, workflows, graph, entities, the
   * standalone workspace-operator history). Default OFF — most users see
   * the focused backbone. Set `NEXT_PUBLIC_FEATURE_ADVANCED_SURFACES=true`
   * to expose them.
   */
  advanced_surfaces: readEnvFlag("NEXT_PUBLIC_FEATURE_ADVANCED_SURFACES", false),

  /**
   * Promotes the Workspace Operator entry point onto the /app home view.
   * Default ON. Flip to false to revert to the legacy hub-and-spoke layout.
   */
  operator_on_home: readEnvFlag("NEXT_PUBLIC_FEATURE_OPERATOR_ON_HOME", true),

  /**
   * Exposes the SAML / OIDC enterprise SSO configuration UI under
   * settings → security. Default ON; flip to false as a kill switch.
   */
  enterprise_sso: readEnvFlag("NEXT_PUBLIC_FEATURE_ENTERPRISE_SSO", true),
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/**
 * Returns the boolean value for a given feature flag. Stable across
 * server and client because the underlying env vars are `NEXT_PUBLIC_*`.
 *
 * @example
 *   if (isFeatureEnabled("advanced_surfaces")) { ... }
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}

/**
 * Convenience alias for `isFeatureEnabled("advanced_surfaces")`. Used
 * pervasively by the sidebar nav and route gates so call sites read
 * declaratively.
 */
export function hasAdvancedSurfaces(): boolean {
  return FEATURE_FLAGS.advanced_surfaces;
}
