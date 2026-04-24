"use client";

/**
 * Client-side loader for CommandPaletteProvider.
 *
 * next/dynamic with ssr: false must live in a Client Component — it is not
 * allowed in Server Components (Next.js 16 lazy-loading docs). This thin
 * wrapper satisfies that constraint while keeping the heavy palette bundle
 * out of the initial page load.
 */

import dynamic from "next/dynamic";

const CommandPaletteProvider = dynamic(
  () =>
    import("@/components/product/command_palette_provider").then(
      (m) => m.CommandPaletteProvider
    ),
  { ssr: false, loading: () => null }
);

export function CommandPaletteProviderLoader() {
  return <CommandPaletteProvider />;
}
