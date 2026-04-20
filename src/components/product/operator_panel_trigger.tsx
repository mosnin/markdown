"use client";

import { useEffect, useState } from "react";

import { GlobalSearch } from "@/components/product/global_search";
import { OperatorPanel } from "@/components/product/operator_panel";

interface BoxRef {
  id: string;
  name: string;
}

interface OperatorPanelTriggerProps {
  /** Boxes in the active workspace — forwarded to the command palette. */
  boxes: BoxRef[];
  /**
   * Default box the operator should target when the user opens the panel
   * from the global command palette. The panel currently requires a box
   * to enable "Generate Plan"; falling back to the first available box
   * lets users run the operator without first navigating to a box page.
   * Pass `undefined` (or rely on the default of `boxes[0]?.id`) when the
   * workspace has no boxes — the panel's submit button will stay disabled.
   */
  defaultBoxId?: string;
}

/**
 * Window event server components can dispatch to open the operator
 * panel. `OperatorPanelTrigger` listens for it and flips `open` to true
 * so any page can expose a "New run" button without needing to live
 * inside this React tree.
 */
export const OPEN_OPERATOR_EVENT = "poggle:open-operator";

/**
 * Client wrapper that owns the open/close state for the Workspace
 * Operator panel and bridges the `GlobalSearch` command palette into
 * it. Mounted by the (server) authenticated app layout in place of a
 * raw `<GlobalSearch />`, since the layout cannot itself hold React
 * state.
 *
 * The panel is rendered as a sibling — it portals via `Sheet`, so its
 * position in the layout tree is irrelevant for visual placement.
 */
export function OperatorPanelTrigger({
  boxes,
  defaultBoxId,
}: OperatorPanelTriggerProps) {
  const [open, setOpen] = useState(false);
  const resolvedDefaultBoxId = defaultBoxId ?? boxes[0]?.id;

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_OPERATOR_EVENT, handler);
    return () => window.removeEventListener(OPEN_OPERATOR_EVENT, handler);
  }, []);

  return (
    <>
      <GlobalSearch boxes={boxes} onOpenOperator={() => setOpen(true)} />
      <OperatorPanel
        open={open}
        onOpenChange={setOpen}
        defaultBoxId={resolvedDefaultBoxId}
      />
    </>
  );
}
