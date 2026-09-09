import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The small caps label that opens a section: the product's `label-caps`. */
export function Kicker({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return <p className={cn("t-label-caps text-ink-3", className)}>{children}</p>;
}
