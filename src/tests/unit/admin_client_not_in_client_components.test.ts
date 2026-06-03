import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Guardrail: the service-role Supabase client (`createAdminClient`, which
 * bypasses Row Level Security) must NEVER be imported into a client component.
 * A single such import risks shipping the service-role key to the browser and
 * collapses tenant isolation. The 2026-06 security review verified zero such
 * imports across the repo; this test makes that invariant enforced by CI so it
 * can't regress as new client components are added.
 */

const SRC = resolve(__dirname, "..", "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** True when the file opens with a "use client" directive (after comments). */
function isClientComponent(source: string): boolean {
  const head = source.slice(0, 800);
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(head);
}

describe("service-role admin client is never imported into a client component", () => {
  const files = walk(SRC);

  it("scans a non-trivial number of source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no 'use client' file imports createAdminClient / @/lib/supabase/admin", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!isClientComponent(src)) continue;
      const importsAdmin =
        /from\s+["']@\/lib\/supabase\/admin["']/.test(src) ||
        /\bcreateAdminClient\b/.test(src);
      if (importsAdmin) offenders.push(f.replace(SRC + "/", "src/"));
    }
    expect(
      offenders,
      `client component(s) importing the RLS-bypassing admin client:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
