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
  packageNote,
}: {
  branchName: string | null;
  branchId: string | null;
  /**
   * Optional extra signal for package-style objects (skills, agents):
   * "This package has branch changes: canonical source · 2 child
   * files · metadata." Rendered on a second line when present.
   */
  packageNote?: string | null;
}) {
  if (!branchName || !branchId) return null;
  return (
    <div
      role="status"
      aria-label="Editing on draft branch"
      className="flex flex-col gap-1 border-b border-warning/30 bg-warning/5 px-4 py-2 text-xs text-warning"
    >
      <div className="flex flex-wrap items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Editing on draft branch{" "}
          <strong className="font-semibold">{branchName}</strong>. Saves go to
          this branch — main is untouched until you promote or discard.
        </span>
        <Link
          href={`/app/branches/${branchId}`}
          className="ml-auto underline hover:text-warning/80"
        >
          Review branch
        </Link>
      </div>
      {packageNote && (
        <p className="ml-5 text-[11px] opacity-90">{packageNote}</p>
      )}
    </div>
  );
}
