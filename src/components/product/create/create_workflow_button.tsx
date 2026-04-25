"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { createWorkflowAction } from "@/app/app/workflows/actions";

export function CreateWorkflowButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onCreate() {
    setError(null);
    startTransition(async () => {
      const name = prompt("Workflow name?");
      if (!name?.trim()) return;
      const res = await createWorkflowAction(name.trim());
      if (res.ok) {
        router.push(`/app/workflows/${res.workflowId}/edit`);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-[11px] text-rose-500">{error}</span>
      )}
      <button
        type="button"
        onClick={onCreate}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        New workflow
      </button>
    </div>
  );
}
