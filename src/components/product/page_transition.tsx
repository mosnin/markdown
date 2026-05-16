"use client";

import * as m from "motion/react-m";

import { fadeRise, listItemProps, staggerContainer } from "@/lib/motion";

/**
 * Wraps a page (or section) so its content fades + rises in on mount.
 * Use as the outermost element of authenticated pages and any place
 * that benefits from a controlled entrance.
 *
 * For lists, prefer <PageStagger> which staggers children using the
 * standard 40ms cadence.
 */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <m.div
      initial="hidden"
      animate="visible"
      variants={fadeRise}
      className={className}
    >
      {children}
    </m.div>
  );
}

/**
 * Stagger container for lists/grids. Children should be wrapped in
 * <StaggerItem> (or any motion component using the same `fadeRise`
 * variant) so each item gets the per-row delay.
 */
export function PageStagger({
  children,
  className,
  staggerChildren = 0.04,
  delayChildren = 0,
}: {
  children: React.ReactNode;
  className?: string;
  staggerChildren?: number;
  delayChildren?: number;
}) {
  return (
    <m.div
      initial="hidden"
      animate="visible"
      variants={staggerContainer(staggerChildren, delayChildren)}
      className={className}
    >
      {children}
    </m.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <m.div {...listItemProps} className={className}>
      {children}
    </m.div>
  );
}
