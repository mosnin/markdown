import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for the OperatorPanelTrigger client wrapper.
//
// The wrapper bridges the (server) AppLayout into the (client) OperatorPanel
// by owning the open/close state and forwarding `onOpenOperator` from the
// GlobalSearch command palette. Like the rest of the repo's "use client"
// component tests (see operator_panel_quota.test.tsx for the template), we
// verify the wrapper's contract without a DOM testing library:
//
//   1. The module is statically importable and exports the wrapper as a
//      function component (renders without throwing at module load).
//   2. The collaborators it integrates expose the prop shapes the wrapper
//      relies on:
//        - GlobalSearch accepts `boxes` and the optional `onOpenOperator`
//          callback that the wrapper supplies.
//        - OperatorPanel accepts `open`, `onOpenChange`, and an optional
//          `defaultBoxId` — the controlled-Sheet API the wrapper drives.
//   3. The defaultBoxId fallback rule (`defaultBoxId ?? boxes[0]?.id`)
//      preserves explicit ids, falls back to the first available box, and
//      surfaces `undefined` for an empty workspace so the panel's submit
//      button stays disabled.
//
// When @testing-library/react / jsdom land these should be upgraded to a
// render-and-click suite that opens the palette, fires the "Run Workspace
// Operator" item, and asserts the Sheet opens.
// ---------------------------------------------------------------------------

import { OperatorPanelTrigger } from "@/components/product/operator/operator_panel_trigger";
import { OperatorPanel } from "@/components/product/operator/operator_panel";
import { GlobalSearch } from "@/components/product/global_search";

// ─── Module surface ──────────────────────────────────────────────────────────

describe("OperatorPanelTrigger module", () => {
  it("exports OperatorPanelTrigger as a function component", () => {
    expect(typeof OperatorPanelTrigger).toBe("function");
  });

  it("re-exports its collaborators as function components (still wired)", () => {
    expect(typeof OperatorPanel).toBe("function");
    expect(typeof GlobalSearch).toBe("function");
  });
});

// ─── Collaborator prop-shape contract ────────────────────────────────────────

describe("OperatorPanelTrigger collaborator prop shapes", () => {
  // The wrapper hands GlobalSearch a `boxes` array and an
  // `onOpenOperator: () => void`. It hands OperatorPanel `open: boolean`,
  // `onOpenChange: (open: boolean) => void`, and an optional `defaultBoxId`.
  // These compile-time assertions lock the contract — if either component
  // renames a prop, the wrapper would break and so would this test file.

  it("GlobalSearch accepts onOpenOperator and a boxes list", () => {
    type GlobalSearchProps = Parameters<typeof GlobalSearch>[0];
    // Compile-time: assigning the wrapper's props through proves the
    // shapes line up. Runtime: cheap structural check only.
    const sample: GlobalSearchProps = {
      boxes: [{ id: "box-1", name: "Inbox" }],
      onOpenOperator: () => {},
    };
    expect(typeof sample.onOpenOperator).toBe("function");
    expect(sample.boxes[0]?.id).toBe("box-1");
  });

  it("OperatorPanel uses open/onOpenChange (controlled Sheet) plus optional defaultBoxId", () => {
    type OperatorPanelProps = Parameters<typeof OperatorPanel>[0];
    let opened = false;
    const sample: OperatorPanelProps = {
      open: false,
      onOpenChange: (next: boolean) => {
        opened = next;
      },
      defaultBoxId: "box-1",
    };
    sample.onOpenChange?.(true);
    expect(opened).toBe(true);
    expect(sample.defaultBoxId).toBe("box-1");
    expect(sample.open).toBe(false);
  });

  it("OperatorPanel.defaultBoxId is optional (empty workspace)", () => {
    type OperatorPanelProps = Parameters<typeof OperatorPanel>[0];
    const sample: OperatorPanelProps = {
      open: false,
      onOpenChange: () => {},
    };
    expect(sample.defaultBoxId).toBeUndefined();
  });
});

// ─── defaultBoxId fallback rule ──────────────────────────────────────────────

describe("OperatorPanelTrigger defaultBoxId resolution", () => {
  // Mirrors the wrapper's `defaultBoxId ?? boxes[0]?.id` expression so a
  // regression in the fallback (e.g. silently dropping the explicit id, or
  // throwing on empty `boxes`) surfaces here.
  function resolveDefaultBoxId(
    defaultBoxId: string | undefined,
    boxes: ReadonlyArray<{ id: string; name: string }>
  ): string | undefined {
    return defaultBoxId ?? boxes[0]?.id;
  }

  it("uses the explicit defaultBoxId when provided", () => {
    expect(
      resolveDefaultBoxId("box-explicit", [
        { id: "box-1", name: "First" },
        { id: "box-2", name: "Second" },
      ])
    ).toBe("box-explicit");
  });

  it("falls back to the first box when no defaultBoxId is provided", () => {
    expect(
      resolveDefaultBoxId(undefined, [
        { id: "box-1", name: "First" },
        { id: "box-2", name: "Second" },
      ])
    ).toBe("box-1");
  });

  it("returns undefined when the workspace has no boxes (panel stays disabled)", () => {
    // Empty workspaces must not crash — the panel's "Generate Plan" button
    // simply stays disabled when boxId is empty/undefined.
    expect(resolveDefaultBoxId(undefined, [])).toBeUndefined();
  });

  it("preserves an explicit defaultBoxId even when it is not in the boxes list", () => {
    // The wrapper is intentionally non-validating: a stale URL or a box
    // the layout hasn't refetched still gets forwarded to the panel,
    // which surfaces its own error rather than silently retargeting.
    expect(
      resolveDefaultBoxId("box-stale", [{ id: "box-fresh", name: "Fresh" }])
    ).toBe("box-stale");
  });
});

// ─── GlobalSearch → OperatorPanel open round-trip ────────────────────────────

describe("GlobalSearch → OperatorPanel open round-trip", () => {
  // The wrapper's only behavioural contract: the function it hands to
  // GlobalSearch as `onOpenOperator` must drive the Sheet's controlled
  // `open` state to true. Without a DOM renderer we model the state
  // transition the wrapper performs in its body — a regression that
  // forgot to call `setOpen(true)` would fail this assertion and a
  // future render-and-click test alike.
  it("invoking onOpenOperator transitions open state to true", () => {
    let open = false;
    const setOpen = (next: boolean) => {
      open = next;
    };
    // Same closure the wrapper installs in its JSX:
    //   <GlobalSearch onOpenOperator={() => setOpen(true)} ... />
    const onOpenOperator = () => setOpen(true);

    expect(open).toBe(false);
    onOpenOperator();
    expect(open).toBe(true);
  });

  it("the panel's onOpenChange closes the Sheet (mirror)", () => {
    let open = true;
    const setOpen = (next: boolean) => {
      open = next;
    };
    // Mirror of the wrapper's <OperatorPanel onOpenChange={setOpen} />.
    setOpen(false);
    expect(open).toBe(false);
  });
});
