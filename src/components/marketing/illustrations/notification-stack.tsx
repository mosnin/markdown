"use client";

import gsap from "gsap";
import { cn } from "@/lib/utils";
import { useGSAP } from "@gsap/react";
import {
  GitCommitHorizontal,
  GitMerge,
  KeyRound,
  MousePointer2,
} from "lucide-react";
import React, { useRef } from "react";
import { FitScale, usePrefersReducedMotion } from "./fit-scale";

/**
 * The change signal. Three events off the company's stream, the same ones
 * `context_changes` returns and a webhook delivers, and a cursor that
 * advances past them. Adapted from ForgeUI "Notification Stack"; the cursor
 * path, the tray expansion and the card timings are the original's.
 */
type EventItem = {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  time: string;
};

const EVENTS: [EventItem, EventItem, EventItem] = [
  {
    id: "item1",
    icon: (
      <GitCommitHorizontal
        className="size-[22px] text-ink"
        strokeWidth={1.75}
      />
    ),
    title: "document_committed",
    description: "marketing/icp · #0142",
    time: "2m ago",
  },
  {
    id: "item2",
    icon: <GitMerge className="size-[22px] text-ink" strokeWidth={1.75} />,
    title: "branch_merged",
    description: "agent/pricing · 2 documents",
    time: "14m ago",
  },
  {
    id: "item3",
    icon: <KeyRound className="size-[22px] text-ink" strokeWidth={1.75} />,
    title: "key_issued",
    description: "cos_7f3a… · context:read",
    time: "1h ago",
  },
];

export function NotificationStack({
  className,
  variant = "events",
}: {
  className?: string;
  variant?: "events" | "inbox";
}) {
  const items: [EventItem, EventItem, EventItem] =
    variant === "inbox"
      ? [
          {
            ...EVENTS[0],
            title: "Draft to review",
            description: "Customer research · ICP update",
          },
          {
            ...EVENTS[1],
            title: "Review overdue",
            description: "Pricing model · Check the plans",
          },
          {
            ...EVENTS[2],
            title: "Reconnect an app",
            description: "Connected app needs attention",
          },
        ]
      : EVENTS;
  const reduced = usePrefersReducedMotion();
  const cursorRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const readButtonRef = useRef<HTMLDivElement>(null);
  const notification1Ref = useRef<HTMLDivElement>(null);
  const notification2Ref = useRef<HTMLDivElement>(null);
  const notification3Ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const ctx = gsap.context(() => {
        gsap.set(notification1Ref.current, { y: 120, opacity: 0, scale: 0.5 });
        gsap.set(notification2Ref.current, { y: 80, opacity: 0, scale: 0.5 });
        gsap.set(notification3Ref.current, { y: 40, opacity: 0, scale: 0.5 });
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1 });
        tl.to(cursorRef.current, {
          x: -90,
          y: 105,
          duration: 0.75,
          ease: "sine.inOut",
        });
        tl.to(cursorRef.current, {
          scale: 0.8,
          duration: 0.1,
          yoyo: true,
          repeat: 1,
          ease: "sine.inOut",
        });
        tl.to(centerRef.current, {
          y: 70,
          width: 280,
          duration: 0.4,
          ease: "sine.inOut",
        });
        tl.to(
          cursorRef.current,
          { x: 10, y: 105, duration: 0.75, delay: 0.15, ease: "sine.inOut" },
          "<",
        );
        tl.to(
          readButtonRef.current,
          { x: 0, duration: 0.3, delay: 0.2, ease: "power1.inOut" },
          "<",
        );
        tl.to(notification1Ref.current, { y: 0, opacity: 1, scale: 1 });
        tl.to(notification2Ref.current, { y: 0, opacity: 1, scale: 0.95 });
        tl.to(notification3Ref.current, { y: 0, opacity: 1, scale: 0.9 });
        tl.addLabel("stacked");
        tl.to(cursorRef.current, {
          x: -20,
          y: 175,
          duration: 0.75,
          ease: "sine.inOut",
        });
        tl.to(cursorRef.current, {
          scale: 0.8,
          duration: 0.1,
          yoyo: true,
          repeat: 1,
          ease: "sine.inOut",
        });
        tl.to(
          readButtonRef.current,
          {
            scale: 0.96,
            duration: 0.1,
            yoyo: true,
            repeat: 1,
            ease: "sine.inOut",
          },
          "<",
        );
        tl.to(notification1Ref.current, { x: 100, opacity: 0, duration: 0.4 });
        tl.to(
          notification2Ref.current,
          { y: -40, scale: 1, delay: 0.3, duration: 0.4, ease: "sine.inOut" },
          "<",
        );
        tl.to(
          notification3Ref.current,
          {
            y: -40,
            scale: 0.95,
            delay: 0.3,
            duration: 0.4,
            ease: "sine.inOut",
          },
          "<",
        );
        tl.to(notification2Ref.current, {
          x: 100,
          opacity: 0,
          delay: 0.2,
          duration: 0.4,
        });
        tl.to(
          notification3Ref.current,
          { y: -80, scale: 1, delay: 0.4, duration: 0.4, ease: "sine.inOut" },
          "<",
        );
        tl.to(notification3Ref.current, {
          x: 100,
          opacity: 0,
          delay: 0.2,
          duration: 0.4,
        });
        tl.to(cursorRef.current, {
          x: 0,
          y: 0,
          delay: 0.3,
          duration: 0.75,
          ease: "sine.inOut",
        });
        tl.to(centerRef.current, {
          y: 0,
          width: 140,
          duration: 0.5,
          ease: "sine.inOut",
        });
        tl.to(
          readButtonRef.current,
          { x: "120%", duration: 0.3, ease: "power1.inOut" },
          "<",
        );

        // Reduced motion: hold the frame with all three events fanned out.
        if (reduced) tl.pause("stacked");
      });

      return () => ctx.revert();
    },
    { dependencies: [reduced], revertOnUpdate: true },
  );

  return (
    <div className={className}>
      <FitScale width={400} height={268}>
        <div className="relative mx-auto flex h-full w-full max-w-[400px] items-center gap-1 px-2">
          <div className="absolute top-0 left-0 h-full w-full p-4">
            <div className="relative h-full w-full">
              <Card
                innerRef={notification3Ref}
                top="top-[100px]"
                item={items[2]}
              />
              <Card
                innerRef={notification2Ref}
                top="top-[70px]"
                item={items[1]}
              />
              <Card
                innerRef={notification1Ref}
                top="top-[40px]"
                item={items[0]}
              />
              <div
                ref={centerRef}
                className={cn(
                  "absolute inset-x-0 top-[100px] mx-auto",
                  "flex h-[32px] w-[140px] items-center justify-between",
                  "rounded-4 border border-border bg-raised shadow-elev-1",
                )}
              >
                <div className="relative top-0 left-0 h-full w-[280px] overflow-hidden rounded-4">
                  <div className="absolute top-0 left-[8px] flex h-full w-full items-center gap-3">
                    <span className="size-[4px] rounded-full bg-caution" />
                    <p className="t-mk-ill-12 text-ink-2">
                      {variant === "inbox"
                        ? "3 items to review"
                        : "3 new events"}
                    </p>
                  </div>
                  <div
                    ref={readButtonRef}
                    aria-hidden="true"
                    className={cn(
                      "absolute top-[2px] right-[2px]",
                      "flex h-[90%] w-[90px] items-center justify-center",
                      "translate-x-[120%] rounded-2 bg-inverse px-2",
                    )}
                  >
                    <span className="t-mk-ill-11 text-ink-inverse">
                      {variant === "inbox" ? "Review items" : "Advance cursor"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div
              ref={cursorRef}
              className="absolute top-[16px] right-[28px] flex items-center"
            >
              <span className="text-ink">
                <MousePointer2
                  className="size-[22px]"
                  fill="currentColor"
                  strokeWidth={1.5}
                />
              </span>
            </div>
          </div>
        </div>
      </FitScale>
    </div>
  );
}

function Card({
  innerRef,
  top,
  item,
}: {
  innerRef?: React.Ref<HTMLDivElement>;
  top: string;
  item: EventItem;
}) {
  return (
    <div
      ref={innerRef}
      className={cn(
        "absolute inset-x-0 mx-auto flex h-[60px] w-full max-w-[290px] scale-[0.5] items-center justify-between rounded-4 border border-border bg-raised px-4 opacity-0 shadow-elev-1",
        top,
      )}
    >
      <div className="flex items-center gap-4">
        <span className="flex size-[32px] items-center justify-center rounded-6 border border-hairline bg-object">
          {item.icon}
        </span>
        <div className="flex flex-col justify-center gap-px">
          <p className="t-mk-ill-mono-12 text-ink">{item.title}</p>
          <p className="t-mk-ill-mono-11 text-ink-3">{item.description}</p>
        </div>
      </div>
      <div className="t-mk-ill-11 text-ink-3">{item.time}</div>
    </div>
  );
}
