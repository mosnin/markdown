import Link from "next/link";
import { GitBranch } from "lucide-react";

/**
 * Small banner the detail pages (notes, files, skills, agents) render
 * above the editor when a draft branch is active, so the user always
 * knows they're editing against a branch rather than main.
 *
 * Passing `branchName = null` (or omitting the prop) hides the banner.
 * The component is deliberately tiny and design-system-native — no
 * raw Git jargon, product-wording ("draft branch", "editing against").
 */
export function ActiveBranchBanner({
  branchName,
  branchId,
}: {
  branchName: string | null;
  branchId: string | null;
}) {
  if (!branchName || !branchId) return null;
  return (
    <div
      role="status"
      aria-label="Editing on draft branch"
      className="flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning/5 px-4 py-2 text-xs text-warning"
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Editing on draft branch{" "}
        <strong className="font-semibold">{branchName}</strong>. Saves go to
        this branch — main is untouched until you promote or discard.
      </span>
      <Link
        href="/app/branches"
        className="ml-auto underline hover:text-warning/80"
      >
        Manage branches
      </Link>
    </div>
  );
}
