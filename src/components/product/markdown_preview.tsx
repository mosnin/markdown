"use client";

import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";

interface MarkdownPreviewProps {
  /** Raw markdown content to render. */
  content: string;
  className?: string;
}

/**
 * Shared markdown preview component.
 *
 * Uses renderMarkdown() from @/lib/markdown as the sole rendering path.
 * All future sanitization or renderer changes should be made in that module.
 *
 * This component is a client component because it receives dynamic content
 * (typed by the user) and renders it. Sanitization note: see lib/markdown.ts.
 */
export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  const html = renderMarkdown(content);

  return (
    <div
      className={cn(
        "prose prose-sm prose-neutral dark:prose-invert max-w-none",
        className
      )}
      // See lib/markdown.ts for the V1 security rationale
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
