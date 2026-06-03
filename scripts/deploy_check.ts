/**
 * Pre-deploy verification script.
 *
 * Read-only pre-flight check that exits non-zero on failure.
 *
 * Run: pnpm tsx scripts/deploy_check.ts
 *
 * Or, if you have a local .env file and no dotenv installed:
 *   node --env-file=.env node_modules/.bin/tsx scripts/deploy_check.ts
 *
 * Checks:
 *   1. Required env vars are set (prints each missing one on stderr).
 *      Optional env vars (OPENAI_API_KEY, EMBEDDING_API_KEY) only WARN when
 *      missing — the app degrades gracefully without them.
 *   2. Supabase DB reachable via admin client.
 *   3. Lists pending migrations in supabase/migrations/*.sql (does not
 *      compare against applied_migrations — just enumerates the repo).
 *   4. Inngest env vars present.
 *   5. Storage bucket "note-images" exists.
 *   6. Optional: Modal harness health check (if MODAL_BASE_URL set).
 *
 * Exits 1 if any required check fails. Warnings are non-fatal.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INNGEST_SIGNING_KEY",
  "INNGEST_EVENT_KEY",
] as const;

/**
 * Optional env vars — missing ones WARN but do not fail the deploy, because the
 * runtime degrades gracefully without them (and src/lib/env.ts does not require
 * them). Keeping these out of REQUIRED keeps this pre-flight check in sync with
 * actual app behavior so a deploy that runs fine isn't blocked.
 *
 *   OPENAI_API_KEY    — only used by /api/voice/transcribe (returns HTTP 503
 *                       "not configured" when absent) and workflow "transform"
 *                       nodes. Core app works without it; voice + AI transforms
 *                       are disabled until it is set.
 *   EMBEDDING_API_KEY — embedding_service.ts no-ops when unset: semantic /
 *                       hybrid search, insights, and the knowledge graph
 *                       gracefully fall back (keyword-only / empty) instead of
 *                       throwing. Core app works without it.
 */
const OPTIONAL_ENV_VARS = ["OPENAI_API_KEY", "EMBEDDING_API_KEY"] as const;

const INNGEST_ENV_VARS = ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY"] as const;

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

// Track whether we've emitted any ✗ (fatal) rows.
let hasFailure = false;

function ok(section: string, msg: string): void {
  console.log(`[${section}] ✓ ${msg}`);
}

function fail(section: string, msg: string): void {
  console.log(`[${section}] ✗ ${msg}`);
  hasFailure = true;
}

function warn(section: string, msg: string): void {
  console.log(`[${section}] ⚠ ${msg}`);
}

function info(section: string, msg: string): void {
  console.log(`[${section}] ${msg}`);
}

// --- 1. Required env vars ------------------------------------------------
info("env", "checking required variables...");
const missingEnv: string[] = [];
for (const name of REQUIRED_ENV_VARS) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    fail("env", `${name} — missing`);
    missingEnv.push(name);
    console.error(name);
  } else {
    ok("env", name);
  }
}

// --- 1b. Optional env vars (warn-only — runtime no-ops without them) ------
for (const name of OPTIONAL_ENV_VARS) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    warn("env", `${name} — not set (optional; related features disabled)`);
  } else {
    ok("env", name);
  }
}

// --- 4. Inngest env vars (subset of required — redundant but explicit) ---
info("inngest", "checking Inngest credentials...");
for (const name of INNGEST_ENV_VARS) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    // Already reported in [env] above; surface under [inngest] for clarity.
    fail("inngest", `${name} — missing`);
  } else {
    ok("inngest", name);
  }
}

// --- 2 & 5. Supabase connectivity + storage bucket ----------------------
// Gate the supabase import behind env checks so we don't crash on import
// when SUPABASE_SERVICE_ROLE_KEY is absent.
async function checkSupabase(): Promise<void> {
  const haveSupabaseEnv =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!haveSupabaseEnv) {
    fail("db", "Supabase env vars missing — cannot test connectivity");
    fail("storage", "Supabase env vars missing — cannot check bucket");
    return;
  }

  // Lazy import so missing env vars don't throw at module load time.
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const admin = createAdminClient();

  // 2. Connectivity — SELECT 1 equivalent.
  try {
    const { error } = await admin.from("workspaces").select("id").limit(1);
    if (error) {
      fail("db", `Supabase query failed: ${error.message}`);
    } else {
      ok("db", "Supabase reachable");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("db", `Supabase query threw: ${msg}`);
  }

  // 5. Storage bucket "note-images" exists.
  try {
    const { data, error } = await admin.storage.listBuckets();
    if (error) {
      fail("storage", `listBuckets failed: ${error.message}`);
    } else {
      const found = (data ?? []).some((b) => b.name === "note-images");
      if (found) {
        ok("storage", 'bucket "note-images" exists');
      } else {
        fail("storage", 'bucket "note-images" missing');
        info(
          "storage",
          '  Run: pnpm tsx scripts/create_storage_bucket.ts',
        );
        info(
          "storage",
          '  (RLS policies are managed via SQL migrations — not auto-configured.)',
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("storage", `listBuckets threw: ${msg}`);
  }
}

// --- 3. List migrations in repo -----------------------------------------
function listMigrations(): void {
  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("migrations", `could not read ${MIGRATIONS_DIR}: ${msg}`);
    return;
  }
  files.sort();
  info("migrations", `${files.length} migrations in repo:`);
  for (const f of files) {
    console.log(`  - ${f}`);
  }
}

// --- 6. Modal harness health check (optional) ---------------------------
async function checkModal(): Promise<void> {
  const baseUrl = process.env.MODAL_BASE_URL;
  if (!baseUrl) {
    warn("modal", "MODAL_BASE_URL not set — skipping health check");
    return;
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/health`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (res.ok) {
      ok("modal", `${url} reachable (HTTP ${res.status})`);
    } else {
      warn("modal", `${url} returned HTTP ${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn("modal", `${url} health check failed: ${msg}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main(): Promise<void> {
  listMigrations();
  await checkSupabase();
  await checkModal();

  console.log("");
  if (hasFailure) {
    console.log("Deploy check FAILED — fix the ✗ items above before deploying.");
    process.exit(1);
  } else {
    console.log("Deploy check passed.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("deploy_check: unexpected error:", err);
  process.exit(1);
});
