import { type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Primary page title */
  title: string;
  /** Optional short description below the title */
  description?: string;
  /**
   * Optional eyebrow label above the title. Pure text by default; pass
   * `eyebrowHref` to render it as a link to the parent (with a leading
   * chevron). Use this for detail pages so the parent context is one
   * click away — e.g. eyebrow="Skills" + eyebrowHref="/app/skills" on
   * a skill detail page.
   */
  eyebrow?: string;
  /** When set, the eyebrow becomes a back-link to this URL. */
  eyebrowHref?: string;
  /** Inline content rendered next to the title (badges, type chips). */
  meta?: ReactNode;
  /** Toolbar actions on the right */
  actions?: ReactNode;
  /**
   * Status / trust row rendered between the description and the bottom
   * divider. Use this for detail-page object headers.
   */
  belowTitle?: ReactNode;
  /** Extra bottom content (tabs, filters) — rendered after the divider */
  below?: ReactNode;
  /** Compact spacing variant for embedded contexts */
  size?: "default" | "sm";
  className?: string;
}

/**
 * Canonical page-level header.
 *
 * Used at the top of every product surface. Establishes a shared rhythm
 * for index pages (skills, agents, audit, settings…) and detail pages
 * (a single skill, a single agent, a single box) — the visual difference
 * is which slots the caller fills, not a separate component.
 *
 * For detail pages, the recommended composition is:
 *
 *   <PageHeader
 *     eyebrow="Skills"
 *     eyebrowHref="/app/skills"
 *     title={skill.name}
 *     meta={<SkillTypeBadges ... />}
 *     description={skill.description}
 *     actions={<ExportMenu /><LifecycleMenu />}
 *     belowTitle={<ObjectTrustHeader ... />}
 *   />
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  eyebrowHref,
  meta,
  actions,
  belowTitle,
  below,
  size = "default",
  className,
}: PageHeaderProps) {
  const compact = size === "sm";

  const eyebrowNode = eyebrow ? (
    eyebrowHref ? (
      <Link
        href={eyebrowHref}
        className={cn(
          "mb-1.5 inline-flex w-fit items-center gap-1 text-overline text-muted-foreground",
          "transition-colors hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:rounded"
        )}
      >
        <ChevronLeft className="h-3 w-3 shrink-0" aria-hidden="true" />
        {eyebrow}
      </Link>
    ) : (
      <p className="mb-1.5 text-overline text-muted-foreground">{eyebrow}</p>
    )
  ) : null;

  return (
    <div className={cn("border-b border-border bg-background", className)}>
      <div
        className={cn(
          "flex items-start justify-between gap-4",
          compact ? "px-5 pt-4 pb-3" : "px-6 pt-6 pb-5 md:px-8 md:pt-7"
        )}
      >
        <div className="min-w-0 flex-1">
          {eyebrowNode}
          {/* Title row — inline meta sits next to the H1 so badges align
              with the type they describe rather than wrapping below. */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <h1
              className={cn(
                "min-w-0 truncate text-foreground",
                compact
                  ? "text-lg font-semibold tracking-tight"
                  : "text-2xl font-semibold tracking-tight"
              )}
            >
              {title}
            </h1>
            {meta && (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {meta}
              </div>
            )}
          </div>
          {description && (
            <p
              className={cn(
                "mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground",
                compact && "mt-1 text-[13px]"
              )}
            >
              {description}
            </p>
          )}
          {belowTitle && <div className="mt-3">{belowTitle}</div>}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {below && (
        <div className={cn(compact ? "px-5" : "px-6 md:px-8")}>{below}</div>
      )}
    </div>
  );
}
