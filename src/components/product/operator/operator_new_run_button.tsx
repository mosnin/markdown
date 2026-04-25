"use client";

import { OPEN_OPERATOR_EVENT } from "@/components/product/operator/operator_panel_trigger";

export function OperatorNewRunButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_OPERATOR_EVENT))}
      className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90 transition-fast"
    >
      New run
    </button>
  );
}
