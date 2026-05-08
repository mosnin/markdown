import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, isValidElement, type ReactElement } from "react";

// ---------------------------------------------------------------------------
// Contract tests for the <ConversationLayout/> primitive.
//
// `ConversationLayout` is a pure-presentational React Server Component
// shell shared by every conversation surface (dashboard composer + plan
// rail, conversation page, future agent scratchpads). It has no internal
// state and no `"use client"` boundary — meaning we can exercise its
// contract two ways without pulling in @testing-library/react / jsdom
// (which the repo intentionally does not ship; see
// `agent_preferences_card.test.tsx` for the canonical template):
//
//   1. **Module surface** — the file exports both the component and its
//      props type, and the function is a valid React component (callable,
//      returns a `ReactElement`).
//
//   2. **Slot wiring** — call the component as a plain function with
//      sentinel ReactNodes for each slot, then walk the returned element
//      tree to assert each slot landed inside the right container with
//      the documented data-testid markers. This is enough to lock in:
//        - all four required slots render
//        - missing optional slots (`planRail`, `sessionsDrawer`) don't
//          throw and don't leave dangling containers
//        - the desktop plan-rail / mobile-stacked layout assertions hold
//          (verified via the responsive Tailwind utility classes on the
//          containers — `lg:flex-row`, `lg:flex` on the rail, etc.)
//        - the data-testid surface is stable so a future
//          render-and-click test (when jsdom lands) can target it.
//
// These are pure-string + element-walk assertions — no DOM, no renderer
// required — so the test runs in the existing Node vitest environment.
// ---------------------------------------------------------------------------

import {
  ConversationLayout,
  type ConversationLayoutProps,
} from "@/components/product/conversation_layout";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SOURCE = readFileSync(
  resolve(REPO_ROOT, "src/components/product/conversation_layout.tsx"),
  "utf8"
);

// ---------------------------------------------------------------------------
// Tree walker — finds the first descendant element with a matching
// data-testid in the (possibly nested) ReactElement tree returned from
// calling the component as a function.
// ---------------------------------------------------------------------------

interface ElementWithTestId {
  testId: string;
  props: Record<string, unknown>;
  className: string;
  children: unknown;
}

function findByTestId(
  node: unknown,
  testId: string
): ElementWithTestId | null {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, testId);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = (node.props ?? {}) as Record<string, unknown>;
  if (props["data-testid"] === testId) {
    return {
      testId,
      props,
      className: typeof props.className === "string" ? props.className : "",
      children: props.children,
    };
  }
  return findByTestId(props.children, testId);
}

function collectTestIds(node: unknown, into: Set<string> = new Set()): Set<string> {
  if (node === null || node === undefined) return into;
  if (Array.isArray(node)) {
    for (const child of node) collectTestIds(child, into);
    return into;
  }
  if (!isValidElement(node)) return into;
  const props = (node.props ?? {}) as Record<string, unknown>;
  if (typeof props["data-testid"] === "string") {
    into.add(props["data-testid"]);
  }
  collectTestIds(props.children, into);
  return into;
}

// Sentinel nodes — each slot gets a uniquely-identifiable element so we
// can prove the right child landed in the right container.
const HEADER = createElement("div", {
  "data-testid": "sentinel-header",
  key: "h",
});
const TRANSCRIPT = createElement("div", {
  "data-testid": "sentinel-transcript",
  key: "t",
});
const COMPOSER = createElement("div", {
  "data-testid": "sentinel-composer",
  key: "c",
});
const PLAN_RAIL = createElement("div", {
  "data-testid": "sentinel-plan-rail",
  key: "p",
});
const SESSIONS_DRAWER = createElement("button", {
  "data-testid": "sentinel-sessions-drawer",
  key: "s",
});

function render(props: ConversationLayoutProps): ReactElement {
  // ConversationLayout is a function component with no hooks — calling
  // it directly is safe and avoids the need for a renderer.
  const out = ConversationLayout(props);
  if (!isValidElement(out)) {
    throw new Error("ConversationLayout did not return a ReactElement");
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Module surface
// ---------------------------------------------------------------------------

describe("ConversationLayout module", () => {
  it("exports ConversationLayout as a function component", () => {
    expect(typeof ConversationLayout).toBe("function");
  });

  it("accepts the documented props shape (compile-time)", () => {
    // Compile-time: assigning a full props object proves the public type
    // matches the JSDoc contract. Runtime: cheap structural check.
    const sample: ConversationLayoutProps = {
      header: HEADER,
      transcript: TRANSCRIPT,
      composer: COMPOSER,
      planRail: PLAN_RAIL,
      sessionsDrawer: SESSIONS_DRAWER,
      className: "extra",
    };
    expect(sample.header).toBe(HEADER);
    expect(sample.transcript).toBe(TRANSCRIPT);
    expect(sample.composer).toBe(COMPOSER);
    expect(sample.planRail).toBe(PLAN_RAIL);
    expect(sample.sessionsDrawer).toBe(SESSIONS_DRAWER);
    expect(sample.className).toBe("extra");
  });

  it("does not declare a 'use client' directive (server component)", () => {
    // The component is meant to be embeddable inside async server pages;
    // a stray "use client" would force the whole conversation column
    // client-side. Lock the server-component status with a string check.
    const firstNonCommentLine =
      SOURCE.split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("/*")) ?? "";
    expect(firstNonCommentLine).not.toMatch(/^["']use client["']/);
  });
});

// ---------------------------------------------------------------------------
// 2. All slots render
// ---------------------------------------------------------------------------

describe("ConversationLayout renders every slot", () => {
  const tree = render({
    header: HEADER,
    transcript: TRANSCRIPT,
    composer: COMPOSER,
    planRail: PLAN_RAIL,
    sessionsDrawer: SESSIONS_DRAWER,
  });

  it("renders the outer layout container", () => {
    const root = findByTestId(tree, "conversation-layout");
    expect(root).not.toBeNull();
  });

  it("renders the conversation main column", () => {
    expect(findByTestId(tree, "conversation-layout-main")).not.toBeNull();
  });

  it("renders the header slot with the supplied node", () => {
    const header = findByTestId(tree, "conversation-layout-header");
    expect(header).not.toBeNull();
    // The supplied sentinel must appear under the header container.
    expect(findByTestId(header!.children, "sentinel-header")).not.toBeNull();
  });

  it("renders the transcript slot with the supplied node", () => {
    const transcript = findByTestId(tree, "conversation-layout-transcript");
    expect(transcript).not.toBeNull();
    expect(
      findByTestId(transcript!.children, "sentinel-transcript")
    ).not.toBeNull();
  });

  it("renders the composer slot with the supplied node", () => {
    const composer = findByTestId(tree, "conversation-layout-composer");
    expect(composer).not.toBeNull();
    expect(findByTestId(composer!.children, "sentinel-composer")).not.toBeNull();
  });

  it("renders the plan-rail slot with the supplied node", () => {
    const rail = findByTestId(tree, "conversation-layout-plan-rail");
    expect(rail).not.toBeNull();
    expect(findByTestId(rail!.children, "sentinel-plan-rail")).not.toBeNull();
  });

  it("renders the sessions-drawer slot with the supplied node", () => {
    const drawer = findByTestId(tree, "conversation-layout-sessions-drawer");
    expect(drawer).not.toBeNull();
    expect(
      findByTestId(drawer!.children, "sentinel-sessions-drawer")
    ).not.toBeNull();
  });

  it("flags the presence of optional slots via data attributes", () => {
    const root = findByTestId(tree, "conversation-layout");
    expect(root!.props["data-has-plan-rail"]).toBe("true");
    expect(root!.props["data-has-sessions-drawer"]).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// 3. Mobile vs desktop layout assertions
// ---------------------------------------------------------------------------

describe("ConversationLayout responsive shape", () => {
  const tree = render({
    header: HEADER,
    transcript: TRANSCRIPT,
    composer: COMPOSER,
    planRail: PLAN_RAIL,
  });

  it("outer container stacks vertically on mobile and horizontally at lg+", () => {
    const root = findByTestId(tree, "conversation-layout");
    expect(root!.className).toMatch(/\bflex-col\b/);
    expect(root!.className).toMatch(/\blg:flex-row\b/);
    // Owns its own height + scroll containment so the inner transcript
    // can be the scroll constraint.
    expect(root!.className).toMatch(/\bh-full\b/);
    expect(root!.className).toMatch(/\boverflow-hidden\b/);
  });

  it("conversation column uses min-w-0 so long content wraps", () => {
    const main = findByTestId(tree, "conversation-layout-main");
    expect(main!.className).toMatch(/\bmin-w-0\b/);
    expect(main!.className).toMatch(/\bflex-1\b/);
    expect(main!.className).toMatch(/\bflex-col\b/);
  });

  it("transcript region is the flex scroll constraint (flex-1 + min-h-0)", () => {
    const transcript = findByTestId(tree, "conversation-layout-transcript");
    expect(transcript!.className).toMatch(/\bflex-1\b/);
    expect(transcript!.className).toMatch(/\bmin-h-0\b/);
    expect(transcript!.className).toMatch(/\boverflow-hidden\b/);
  });

  it("composer pins to the bottom with a top hairline + safe-area inset", () => {
    const composer = findByTestId(tree, "conversation-layout-composer");
    expect(composer!.className).toMatch(/\bshrink-0\b/);
    expect(composer!.className).toMatch(/\bborder-t\b/);
    expect(composer!.className).toMatch(/\bborder-border\b/);
    // iOS safe-area: home-indicator clearance.
    expect(composer!.className).toMatch(
      /pb-\[env\(safe-area-inset-bottom\)\]/
    );
  });

  it("plan rail is hidden on mobile and shown at lg+ with a fixed width", () => {
    const rail = findByTestId(tree, "conversation-layout-plan-rail");
    expect(rail!.className).toMatch(/\bhidden\b/);
    expect(rail!.className).toMatch(/\blg:flex\b/);
    expect(rail!.className).toMatch(/(?:^|\s)w-\[420px\](?:\s|$)/);
    expect(rail!.className).toMatch(/\bborder-l\b/);
  });

  it("plan rail uses semantic background tokens, not raw hex", () => {
    const rail = findByTestId(tree, "conversation-layout-plan-rail");
    // No `#fff`, no `bg-[#...]` — only the semantic `bg-background` token.
    expect(rail!.className).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(rail!.className).toMatch(/\bbg-background\b/);
  });
});

// ---------------------------------------------------------------------------
// 4. Missing optional slots don't crash
// ---------------------------------------------------------------------------

describe("ConversationLayout handles missing optional slots", () => {
  it("renders without a plan rail (mobile-only callers)", () => {
    const tree = render({
      header: HEADER,
      transcript: TRANSCRIPT,
      composer: COMPOSER,
    });
    expect(findByTestId(tree, "conversation-layout-main")).not.toBeNull();
    expect(findByTestId(tree, "conversation-layout-plan-rail")).toBeNull();

    const root = findByTestId(tree, "conversation-layout");
    expect(root!.props["data-has-plan-rail"]).toBe("false");
  });

  it("renders without a sessions drawer (no header chrome)", () => {
    const tree = render({
      header: HEADER,
      transcript: TRANSCRIPT,
      composer: COMPOSER,
      planRail: PLAN_RAIL,
    });
    expect(
      findByTestId(tree, "conversation-layout-sessions-drawer")
    ).toBeNull();

    const root = findByTestId(tree, "conversation-layout");
    expect(root!.props["data-has-sessions-drawer"]).toBe("false");

    // Header still renders — without the drawer, the header container
    // is the bare wrapper around the supplied node.
    const header = findByTestId(tree, "conversation-layout-header");
    expect(header).not.toBeNull();
    expect(findByTestId(header!.children, "sentinel-header")).not.toBeNull();
  });

  it("renders with neither optional slot (the minimum viable shape)", () => {
    const tree = render({
      header: HEADER,
      transcript: TRANSCRIPT,
      composer: COMPOSER,
    });

    const ids = collectTestIds(tree);
    // Required containers present.
    expect(ids.has("conversation-layout")).toBe(true);
    expect(ids.has("conversation-layout-main")).toBe(true);
    expect(ids.has("conversation-layout-header")).toBe(true);
    expect(ids.has("conversation-layout-transcript")).toBe(true);
    expect(ids.has("conversation-layout-composer")).toBe(true);
    // Optional containers absent.
    expect(ids.has("conversation-layout-plan-rail")).toBe(false);
    expect(ids.has("conversation-layout-sessions-drawer")).toBe(false);
  });

  it("does not throw on null/undefined optional props", () => {
    expect(() =>
      render({
        header: HEADER,
        transcript: TRANSCRIPT,
        composer: COMPOSER,
        planRail: undefined,
        sessionsDrawer: undefined,
      })
    ).not.toThrow();
  });

  it("forwards an explicit className onto the outer container", () => {
    const tree = render({
      header: HEADER,
      transcript: TRANSCRIPT,
      composer: COMPOSER,
      className: "my-extra-token",
    });
    const root = findByTestId(tree, "conversation-layout");
    expect(root!.className).toMatch(/\bmy-extra-token\b/);
  });
});

// ---------------------------------------------------------------------------
// 5. Source-level invariants
// ---------------------------------------------------------------------------

describe("conversation_layout.tsx source contract", () => {
  it("documents a usage example in the top-of-file JSDoc", () => {
    // The brief requires a JSDoc usage example so adopters (Agents A1
    // and A4) have a copy-pasteable starting point. Lock it in.
    expect(SOURCE).toMatch(/\/\*\*[\s\S]*?Usage[\s\S]*?<ConversationLayout[\s\S]*?\*\//);
  });

  it("exports the props interface alongside the component", () => {
    // The brief calls out the prop shape explicitly — keep it exported
    // so downstream callers can type their wrappers without redeclaring.
    expect(SOURCE).toMatch(/export\s+interface\s+ConversationLayoutProps\b/);
  });

  it("does not introduce raw hex colors (style brief requirement)", () => {
    // Brief: "Use foundation tokens; no raw hex." Allow only the
    // documented `420px` width literal and Tailwind safe-area syntax;
    // bail on any `#rgb`/`#rrggbb` literal.
    expect(SOURCE).not.toMatch(/#[0-9a-fA-F]{3}\b/);
    expect(SOURCE).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it("does not import any 'use client' boundary children at module top", () => {
    // The component must remain a Server Component — its only runtime
    // import is `cn` from `@/lib/utils`. Adding a client-only import
    // here would either break SSR or force the boundary upstream.
    const importLines = SOURCE.split("\n").filter((l) =>
      /^\s*import\s/.test(l)
    );
    for (const line of importLines) {
      expect(line).not.toMatch(/from\s+["']next\/navigation["']/);
      expect(line).not.toMatch(/from\s+["']react\/jsx-dev-runtime["']/);
    }
    // Sanity: the only non-React import is the cn helper.
    expect(SOURCE).toMatch(/from\s+["']@\/lib\/utils["']/);
  });
});
