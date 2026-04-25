import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for the OperatorRunDiff "summary of what changed" view.
//
// The component splits into two pieces:
//   - OperatorRunDiff (async server) — fetches note previews then hands
//     a fully-resolved list to OperatorRunDiffView.
//   - OperatorRunDiffView (pure) — renders the artifact list, greying
//     out / striking through rolled-back rows.
//
// We exercise only the pure view here so we don't need to mock
// supabase. The renderer turn is asserted by walking the React element
// tree returned from the function — sufficient to catch a regression
// where rolled-back rows lose the "deleted" affordance, without pulling
// in @testing-library/react.
// ---------------------------------------------------------------------------

import {
  OperatorRunDiff,
  OperatorRunDiffView,
} from "@/components/product/operator/operator_run_diff";

interface ReactNodeLike {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
}

/**
 * Walk a React element tree, expanding function components by invoking
 * them with their props. We don't have a real renderer here, so we
 * unroll the tree manually — sufficient to assert `data-` attribute
 * presence and string children without booting jsdom.
 */
function flatten(node: unknown, out: ReactNodeLike[] = []): ReactNodeLike[] {
  if (node == null || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") return out;
  if (Array.isArray(node)) {
    for (const c of node) flatten(c, out);
    return out;
  }
  const n = node as ReactNodeLike;
  // If the element's `type` is itself a function component, render it
  // (with its props) and recurse into the returned tree. Otherwise it's
  // a host element / fragment whose children we already have.
  if (typeof n.type === "function") {
    out.push(n);
    try {
      const rendered = (n.type as (p: unknown) => unknown)(n.props ?? {});
      // Recurse only into the rendered output; the original `children`
      // prop is already projected by the function component into that
      // output, so walking it again would double-count host elements.
      flatten(rendered, out);
    } catch {
      // Some components (e.g. those that read context) may throw when
      // called outside a renderer. Fall back to walking the original
      // children so badge labels nested in component-typed children
      // still surface.
      if (n.props && "children" in n.props) {
        flatten(n.props.children, out);
      }
    }
    return out;
  }
  out.push(n);
  if (n.props && "children" in n.props) {
    flatten(n.props.children, out);
  }
  return out;
}

function findByDataAttr(
  tree: unknown,
  attr: string,
  value: string
): ReactNodeLike[] {
  // Restrict to host elements (string `type`) so we don't double-count
  // a function-component element + its rendered child that both happen
  // to carry the same prop.
  return flatten(tree).filter((n) => {
    if (typeof n.type !== "string") return false;
    const props = n.props ?? {};
    return (props as Record<string, unknown>)[attr] === value;
  });
}

describe("OperatorRunDiff module surface", () => {
  it("exports OperatorRunDiff and OperatorRunDiffView as functions", () => {
    expect(typeof OperatorRunDiff).toBe("function");
    expect(typeof OperatorRunDiffView).toBe("function");
  });
});

describe("OperatorRunDiffView rendering", () => {
  it("renders the empty state when there are no artifacts", () => {
    const out = OperatorRunDiffView({ resolved: [] });
    const flat = flatten(out);
    const text = flat
      .map((n) => {
        const c = n.props?.children;
        return typeof c === "string" ? c : "";
      })
      .join(" ");
    expect(text).toMatch(/did not produce any artifacts/);
  });

  it("renders one card per artifact with a data-rolled-back marker", () => {
    const out = OperatorRunDiffView({
      resolved: [
        { noteId: "note-1", title: "Live note", deleted: false, preview: "live" },
        {
          noteId: "note-2",
          title: "Trashed note",
          deleted: true,
          preview: "",
        },
      ],
    });
    // Two artifact rows, exactly one of which is marked rolled back.
    const liveRows = findByDataAttr(out, "data-rolled-back", "false");
    const deletedRows = findByDataAttr(out, "data-rolled-back", "true");
    expect(liveRows.length).toBe(1);
    expect(deletedRows.length).toBe(1);
  });

  it("renders a 'deleted' badge for rolled-back artifacts", () => {
    const out = OperatorRunDiffView({
      resolved: [
        {
          noteId: "note-2",
          title: "Trashed note",
          deleted: true,
          preview: "",
        },
      ],
    });
    const flat = flatten(out);
    const labels = flat
      .map((n) => n.props?.children)
      .filter((c): c is string => typeof c === "string");
    expect(labels).toContain("deleted");
  });

  it("does NOT render a 'deleted' badge for live artifacts", () => {
    const out = OperatorRunDiffView({
      resolved: [
        {
          noteId: "note-1",
          title: "Live note",
          deleted: false,
          preview: "live preview",
        },
      ],
    });
    const flat = flatten(out);
    const labels = flat
      .map((n) => n.props?.children)
      .filter((c): c is string => typeof c === "string");
    expect(labels).not.toContain("deleted");
  });
});
