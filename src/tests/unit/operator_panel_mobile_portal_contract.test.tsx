import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Contract test: Operator panel × Mobile sidebar portal isolation.
//
// Both the OperatorPanel (workspace_operator) and the MobileSidebar use the
// shadcn/Base-UI <Sheet> primitive, which mounts its content into a Floating
// UI portal. When a Sheet is rendered inside another open Sheet's portal,
// Base UI's portal-stacking heuristic can latch the inner sheet open and
// block scroll restoration on the outer one. Symptom: tapping the hamburger
// on mobile after the operator panel has been opened locks the page.
//
// The fix in production is structural — both triggers live at the app
// layout root as siblings, never nested. This test guards that structure
// without a browser by reading the source files as strings and asserting:
//
//   1. `mobile_sidebar.tsx` does NOT import or render OperatorPanel — the
//      operator panel must never be embedded inside the mobile Sheet.
//   2. `OperatorPanelTrigger` is mounted at the layout root, OUTSIDE any
//      <Sheet> or <MobileSidebar>/<MobileShellSidebar> JSX subtree.
//   3. The mobile sidebar trigger and the operator panel trigger appear at
//      the same JSX depth in app/layout.tsx (siblings, not nested).
//   4. The "Base UI Floating UI portals nesting" canary comment is still
//      present in mobile_sidebar.tsx — its removal in tandem with adding
//      OperatorPanel inside the Sheet would re-introduce the bug.
//   5. OperatorPanel itself uses <Sheet> (not <Dialog>) at the top level,
//      locking the mobile-friendly primitive that motivates this guard.
//
// These are pure-string assertions — no DOM, no renderer required — so the
// test runs in the existing Node vitest environment.
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(__dirname, "..", "..", "..");

function readSource(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), "utf8");
}

const operatorPanelSrc = readSource("src/components/product/operator_panel.tsx");
const mobileSidebarSrc = readSource("src/components/product/mobile_sidebar.tsx");
const layoutSrc = readSource("src/app/app/layout.tsx");

// ─── 1. mobile_sidebar.tsx must not import or render OperatorPanel ───────────

describe("mobile_sidebar.tsx does not embed the OperatorPanel", () => {
  it("does not import OperatorPanel", () => {
    // Any import statement that pulls in OperatorPanel would risk nesting
    // its Sheet portal inside the mobile sidebar's Sheet portal.
    expect(mobileSidebarSrc).not.toMatch(
      /import\s*\{[^}]*\bOperatorPanel\b[^}]*\}\s*from/
    );
    expect(mobileSidebarSrc).not.toMatch(
      /from\s*["']@\/components\/product\/operator_panel["']/
    );
  });

  it("does not render <OperatorPanel /> JSX", () => {
    // Belt-and-braces: even a non-imported reference (e.g. via dynamic
    // import) shouldn't appear as a JSX tag in the sheet body.
    expect(mobileSidebarSrc).not.toMatch(/<\s*OperatorPanel(\s|\/|>)/);
  });

  it("does not render <OperatorPanelTrigger /> JSX", () => {
    // The trigger owns the panel's open state — embedding it inside the
    // mobile Sheet would also nest the panel's portal once opened.
    expect(mobileSidebarSrc).not.toMatch(/<\s*OperatorPanelTrigger(\s|\/|>)/);
  });
});

// ─── 2. OperatorPanelTrigger lives at the layout root, not inside Sheet ─────

describe("OperatorPanelTrigger is mounted at the layout root", () => {
  it("layout imports OperatorPanelTrigger", () => {
    expect(layoutSrc).toMatch(
      /import\s*\{\s*OperatorPanelTrigger\s*\}\s*from\s*["']@\/components\/product\/operator_panel_trigger["']/
    );
  });

  it("layout renders <OperatorPanelTrigger />", () => {
    expect(layoutSrc).toMatch(/<\s*OperatorPanelTrigger(\s|\/|>)/);
  });

  it("layout does not import the MobileSidebar Sheet primitive directly", () => {
    // The layout uses MobileShellSidebar (which delegates to MobileSidebar)
    // — the <Sheet> primitive itself is never imported at the layout root,
    // so the trigger cannot accidentally be wrapped in one here.
    expect(layoutSrc).not.toMatch(
      /from\s*["']@\/components\/ui\/sheet["']/
    );
    expect(layoutSrc).not.toMatch(/<\s*Sheet(\s|>)/);
  });

  it("OperatorPanelTrigger is not nested inside a <Sheet>...</Sheet> subtree", () => {
    // Defensive cross-check: scan for any <Sheet ...> ... </Sheet> block
    // and assert OperatorPanelTrigger does not appear within it.
    const sheetBlocks = layoutSrc.match(/<Sheet[\s\S]*?<\/Sheet>/g) ?? [];
    for (const block of sheetBlocks) {
      expect(block).not.toMatch(/OperatorPanelTrigger/);
    }
  });

  it("OperatorPanelTrigger is not nested inside a <MobileSidebar> or <MobileShellSidebar> subtree", () => {
    // Self-closed mobile sidebar tags are fine — those have no children.
    // The bug would be a paired <MobileSidebar>...</MobileSidebar> wrapper
    // that contains the trigger.
    for (const tag of ["MobileSidebar", "MobileShellSidebar"]) {
      const re = new RegExp(`<${tag}[^/]*?>[\\s\\S]*?</${tag}>`, "g");
      const blocks = layoutSrc.match(re) ?? [];
      for (const block of blocks) {
        expect(block).not.toMatch(/OperatorPanelTrigger/);
      }
    }
  });
});

// ─── 3. MobileShellSidebar (wrapping MobileSidebar) and OperatorPanelTrigger
//        share the layout root ────────────────────────────────────────────────

describe("Mobile sidebar mount and OperatorPanelTrigger share the layout root", () => {
  it("both mounts appear in the layout file", () => {
    // The layout imports MobileShellSidebar, which is the production
    // wrapper that renders <MobileSidebar />. That indirection is what
    // makes them de-facto siblings rather than nested.
    expect(layoutSrc).toMatch(/<\s*MobileShellSidebar(\s|\/|>)/);
    expect(layoutSrc).toMatch(/<\s*OperatorPanelTrigger(\s|\/|>)/);
  });

  it("neither mount nests the other", () => {
    // Same JSX-depth check as above, applied symmetrically: the mobile
    // sidebar mount must not contain the operator trigger, and vice versa.
    const mobileMountBlocks =
      layoutSrc.match(/<MobileShellSidebar[^/]*?>[\s\S]*?<\/MobileShellSidebar>/g) ??
      [];
    for (const block of mobileMountBlocks) {
      expect(block).not.toMatch(/OperatorPanelTrigger/);
    }

    const triggerBlocks =
      layoutSrc.match(
        /<OperatorPanelTrigger[^/]*?>[\s\S]*?<\/OperatorPanelTrigger>/g
      ) ?? [];
    for (const block of triggerBlocks) {
      expect(block).not.toMatch(/MobileShellSidebar|MobileSidebar/);
    }
  });

  it("both mounts share the same top-level <header>/layout root container", () => {
    // The header element of the layout contains both — neither is nested
    // inside a <Sheet>/<Dialog>/<Popover> portal-bearing primitive at the
    // layout root.
    const headerMatch = layoutSrc.match(/<header[\s\S]*?<\/header>/);
    expect(headerMatch).not.toBeNull();
    const header = headerMatch![0];
    expect(header).toMatch(/MobileShellSidebar/);
    expect(header).toMatch(/OperatorPanelTrigger/);
    // Sanity: no Sheet/Dialog wraps either inside the header.
    expect(header).not.toMatch(/<\s*Sheet(\s|>)/);
    expect(header).not.toMatch(/<\s*Dialog(\s|>)/);
  });
});

// ─── 4. Canary comment regression guard ─────────────────────────────────────

describe("mobile_sidebar.tsx canary comment is preserved", () => {
  it("retains the 'Base UI Floating UI portals nesting' explanation", () => {
    // If a future refactor strips this comment AND embeds OperatorPanel
    // inside the Sheet, this assertion fires before the bug ships.
    expect(mobileSidebarSrc).toMatch(/Base UI Floating UI portals nesting/);
  });

  it("retains a reference to the Sheet's own portal nesting hazard", () => {
    // The comment also names the symptom — keep the explanatory phrasing
    // so future readers know *why* nothing portal-bearing belongs inside.
    expect(mobileSidebarSrc).toMatch(/Sheet'?s\s+own portal/);
  });
});

// ─── 5. OperatorPanel uses Sheet (not Dialog) at the top level ──────────────

describe("operator_panel.tsx uses Sheet as its top-level primitive", () => {
  it("imports Sheet from @/components/ui/sheet", () => {
    expect(operatorPanelSrc).toMatch(
      /import\s*\{[^}]*\bSheet\b[^}]*\}\s*from\s*["']@\/components\/ui\/sheet["']/
    );
  });

  it("imports SheetContent / SheetHeader / SheetTitle alongside Sheet", () => {
    // These named imports are part of the Sheet primitive's contract — if
    // a refactor swaps to <Dialog>, all four should disappear together.
    expect(operatorPanelSrc).toMatch(/\bSheetContent\b/);
    expect(operatorPanelSrc).toMatch(/\bSheetHeader\b/);
    expect(operatorPanelSrc).toMatch(/\bSheetTitle\b/);
  });

  it("renders the controlled Sheet wrapping its content", () => {
    // The component's outer return must be a <Sheet open={...}
    // onOpenChange={...}> wrapping <SheetContent>. A migration to
    // <Dialog> would silently change the portal stacking behavior.
    expect(operatorPanelSrc).toMatch(
      /<Sheet\s+open=\{[^}]+\}\s+onOpenChange=/
    );
    expect(operatorPanelSrc).toMatch(/<SheetContent\b/);
  });
});
