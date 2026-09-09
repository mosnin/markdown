import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Variant = "solid" | "outline" | "ghost";
type Size = "md" | "lg";

/**
 * Mapped onto this app's Button variants: its "default" is the flat monochrome
 * action the design language calls for, and "outline" is the secondary. The
 * names differ from the source app; the pixels do not.
 */
const VARIANT = {
  solid: "default",
  outline: "outline",
  ghost: "ghost",
} as const;

const SIZE = {
  md: "default",
  lg: "lg",
} as const;

/**
 * The site's call to action is the product's button, nothing more: the same
 * heights, radius, fill and focus ring a person meets once they sign in. The
 * name survives from the chamfered original so call sites did not have to
 * change; the chamfer did not.
 *
 * Rendered as a styled Link rather than `<Button asChild>` because this app's
 * Button does not take asChild — the class recipe is the shared part, and
 * using it directly keeps the anchor a real anchor.
 */
export function CutButton({
  href,
  children,
  variant = "solid",
  size = "md",
  className,
  external = false,
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
  external?: boolean;
}): ReactNode {
  const rest = external ? { target: "_blank", rel: "noreferrer" } : {};
  return (
    <Link
      href={href}
      className={cn(
        buttonVariants({ variant: VARIANT[variant], size: SIZE[size] }),
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
