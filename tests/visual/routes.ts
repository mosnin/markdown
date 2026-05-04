/**
 * Single source of truth for the routes that the visual-regression and
 * a11y suites cover. Adding a route here automatically wires it into both
 * suites (desktop + mobile capture for VR, axe scan for a11y).
 *
 * `requiresAuth` routes go through the mocked-auth fixture in
 * `auth.fixture.ts`. When `SKIP_AUTH_VR=1` is set, those routes are
 * skipped so the marketing-only baseline still runs without secrets.
 */
export interface VisualRoute {
  /** Stable id used for screenshot filenames. */
  id: string;
  /** Path relative to `baseURL`. */
  path: string;
  /** True when the route requires a mocked authenticated session. */
  requiresAuth: boolean;
}

export const visualRoutes: readonly VisualRoute[] = [
  { id: "marketing-home", path: "/", requiresAuth: false },
  { id: "sign-in", path: "/sign_in", requiresAuth: false },
  { id: "app-dashboard", path: "/app", requiresAuth: true },
  {
    id: "admin-performance",
    path: "/app/admin/performance",
    requiresAuth: true,
  },
] as const;

export const viewports = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
} as const;

export type ViewportName = keyof typeof viewports;
