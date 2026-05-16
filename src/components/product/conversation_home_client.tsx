"use client";

import { OperatorPanel } from "@/components/product/operator/operator_panel";

export interface ConversationHomeClientProps {
  defaultBoxId?: string | null;
}

export function ConversationHomeClient({
  defaultBoxId,
}: ConversationHomeClientProps) {
  return (
    <div className="flex flex-col h-full">
      <OperatorPanel
        mode="page"
        defaultBoxId={defaultBoxId ?? undefined}
      />
    </div>
  );
}
