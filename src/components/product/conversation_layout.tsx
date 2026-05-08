import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Two-pane conversation layout primitive.
 *
 * A reusable shell shared by every conversation surface in the product
 * (the workspace dashboard's operator composer + plan rail, the dedicated
 * conversation page, and any future agent-driven scratchpad). Centralises
 * the desktop / mobile responsive contract so callers don't keep
 * re-implementing the same `flex-col / overflow-hidden / lg:flex-row`
 * dance.
 *
 * ## Anatomy
 *
 *   ┌──────────────────────────────────────────────────────┬──────────────┐
 *   │ header (PageHeader, sticky-ish at top)               │              │
 *   ├──────────────────────────────────────────────────────┤              │
 *   │                                                      │              │
 *   │ transcript (scrollable middle — flex-1 min-h-0)      │  planRail    │
 *   │                                                      │  (lg+ only)  │
 *   │                                                      │              │
 *   ├──────────────────────────────────────────────────────┤              │
 *   │ composer (pinned at bottom; sticky to viewport on    │              │
 *   │ mobile via env(safe-area-inset-bottom))              │              │
 *   └──────────────────────────────────────────────────────┴──────────────┘
 *
 *   sessionsDrawer renders inline near the header — typically a Sheet
 *   trigger button on small screens that opens a session list. It is
 *   always visible when supplied; callers gate its own visibility (e.g.
 *   `lg:hidden`) within the node they pass.
 *
 * ## Responsive contract
 *
 * - **Mobile (< lg):** single column. `transcript` is the scroll
 *   container. `composer` is pinned to the bottom of the column and uses
 *   `pb-[env(safe-area-inset-bottom)]` so it clears the home-indicator on
 *   iOS. `planRail` is hidden — callers should expose it via a Sheet
 *   trigger in the `sessionsDrawer` slot or inside the composer node.
 * - **Desktop (lg+):** two columns. Left column is the conversation
 *   (header / transcript / composer). Right column is the plan rail at
 *   a fixed 420px width with a hairline left border.
 *
 * The component is a Server Component — it owns no state and adds no
 * `"use client"` boundary so it can be composed inside async server
 * pages without forcing the children client-side.
 *
 * ## Usage
 *
 * ```tsx
 * import { ConversationLayout } from "@/components/product/conversation_layout";
 * import { PageHeader } from "@/components/product/page_header";
 *
 * export default async function Page() {
 *   return (
 *     <ConversationLayout
 *       header={<PageHeader title="Conversation" />}
 *       transcript={<ConversationTranscript />}
 *       composer={<ConversationComposer ... />}
 *       planRail={<DashboardPlanPanel ... />}
 *       sessionsDrawer={<SessionsSheetTrigger />}
 *     />
 *   );
 * }
 * ```
 *
 * - `planRail` and `sessionsDrawer` are optional; when omitted, the
 *   layout falls back to the mobile single-column shape on every
 *   breakpoint.
 * - All four content slots accept any `ReactNode`. The primitive does
 *   not impose padding inside the slots — callers control their own
 *   horizontal gutters so the existing `max-w-3xl mx-auto` patterns in
 *   transcripts continue to work unchanged.
 */
export interface ConversationLayoutProps {
  /** Top header — typically a `<PageHeader>`. Pinned at the top of the
   *  conversation column. */
  header: ReactNode;
  /** The scrollable middle region. Receives `flex-1` and `min-h-0` so
   *  long transcripts scroll instead of pushing the composer offscreen. */
  transcript: ReactNode;
  /** The input bar pinned at the bottom of the conversation column. On
   *  mobile, sits flush with the viewport bottom and respects the
   *  safe-area inset. */
  composer: ReactNode;
  /** Optional right-side rail (plan / diff). Visible at `lg+` only;
   *  hidden on smaller screens — callers should surface it via a Sheet
   *  inside `sessionsDrawer` or inline within `composer` when needed. */
  planRail?: ReactNode;
  /** Optional sessions drawer affordance — typically a Sheet trigger.
   *  Renders adjacent to the header on small screens. The caller is
   *  responsible for hiding it at `lg+` if the drawer is mobile-only. */
  sessionsDrawer?: ReactNode;
  /** Optional className applied to the outer flex container. */
  className?: string;
}

export function ConversationLayout({
  header,
  transcript,
  composer,
  planRail,
  sessionsDrawer,
  className,
}: ConversationLayoutProps) {
  return (
    <div
      data-testid="conversation-layout"
      data-has-plan-rail={planRail ? "true" : "false"}
      data-has-sessions-drawer={sessionsDrawer ? "true" : "false"}
      className={cn(
        // Outer shell: full height of the parent (the app layout already
        // owns `h-full`), single column on mobile, side-by-side at lg+.
        "flex h-full min-h-0 flex-col overflow-hidden lg:flex-row",
        className
      )}
    >
      {/* Conversation column — header, scrollable transcript, pinned
          composer. `min-w-0` lets long words wrap inside the transcript
          without pushing the column wider than its parent. */}
      <div
        data-testid="conversation-layout-main"
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        {/* Header row — when a sessionsDrawer is supplied we wrap header
            + drawer in a horizontal flex so the trigger sits to the right
            of the title without disturbing the existing header's own
            actions slot. The header stays the dominant child (`flex-1
            min-w-0`) so the drawer button never pushes the title offscreen. */}
        {sessionsDrawer ? (
          <div
            data-testid="conversation-layout-header"
            className="flex items-stretch border-b border-border"
          >
            <div className="min-w-0 flex-1">{header}</div>
            <div
              data-testid="conversation-layout-sessions-drawer"
              className="flex shrink-0 items-center px-3 sm:px-4"
            >
              {sessionsDrawer}
            </div>
          </div>
        ) : (
          <div data-testid="conversation-layout-header">{header}</div>
        )}

        {/* Transcript — flex-1 + min-h-0 are both required so the inner
            scroll container actually scrolls inside its flex parent
            (otherwise the column grows to fit the content). Callers are
            responsible for choosing whether to wrap their transcript in
            a `<ScrollArea>` or rely on native overflow. The wrapper here
            simply guarantees the layout slot is the scroll constraint. */}
        <div
          data-testid="conversation-layout-transcript"
          className="min-h-0 flex-1 overflow-hidden"
        >
          {transcript}
        </div>

        {/* Composer — pinned at the bottom of the conversation column.
            On mobile we keep it inside the column flow (sticky-feeling
            because the transcript above is the scroll container). The
            safe-area inset + hairline top border match every other
            bottom-pinned input bar in the product. */}
        <div
          data-testid="conversation-layout-composer"
          className={cn(
            "shrink-0 border-t border-border bg-background",
            // Phone safe area: clear the home-indicator on iOS without
            // adding visible whitespace on devices that report 0px.
            "pb-[env(safe-area-inset-bottom)]"
          )}
        >
          {composer}
        </div>
      </div>

      {/* Plan rail — fixed-width sidecar at lg+, hidden below. The
          hairline left border anchors it visually against the
          conversation column without a heavy divider. */}
      {planRail && (
        <aside
          data-testid="conversation-layout-plan-rail"
          aria-label="Conversation plan rail"
          className="hidden w-[420px] shrink-0 flex-col border-l border-border bg-background lg:flex"
        >
          {planRail}
        </aside>
      )}
    </div>
  );
}
