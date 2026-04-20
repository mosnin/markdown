/**
 * Operator cascade audit — CI guard.
 *
 * Parses every operator migration .sql file in supabase/migrations/ and
 * asserts that each foreign key on `workspace_id` or `user_id` declares
 * the project's required ON DELETE action:
 *
 *   - workspace_id  -> ON DELETE CASCADE          (always)
 *   - user_id       -> ON DELETE CASCADE          (personal-data tables)
 *                   -> ON DELETE SET NULL         (run-history audit tables)
 *
 * The audit is purely textual — it regex-matches the SQL source so it can
 * run on every PR with no database. If a future migration adds a
 * workspace_id FK without CASCADE (or otherwise violates the policy) this
 * test will fail in CI before the migration ships.
 *
 * If you legitimately need a different ON DELETE action for a NEW operator
 * column, add the (table, column) pair to the corresponding allow-list
 * below and document why in the migration's comment header.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");

/**
 * The migrations this guard owns. Adding a new operator migration that
 * introduces a workspace_id / user_id FK should be accompanied by a line
 * here so the audit catches its cascades on the next CI run.
 *
 * Out-of-scope migrations (e.g. the Phase-4 workspace_operator_usage
 * rollup) are intentionally excluded — they have their own historical
 * deletion semantics that pre-date this audit.
 */
const AUDITED_MIGRATIONS = new Set<string>([
  "20260419000001_workspace_operator_runs.sql",
  "20260420000001_operator_cancel_and_budget.sql",
  "20260420000002_operator_artifacts_and_prompts.sql",
  "20260420000003_operator_notification_preferences.sql",
  "20260420000005_operator_cascade_fix.sql",
]);

/**
 * Tables whose user_id FK should resolve to SET NULL on user deletion
 * because the rows are an audit trail (anonymise rather than delete).
 *
 * Everything else with a user_id FK is treated as personal data and must
 * CASCADE.
 */
const USER_ID_SET_NULL_TABLES = new Set<string>([
  "workspace_operator_runs",
]);

// ---------------------------------------------------------------------------
// SQL parsing
// ---------------------------------------------------------------------------

interface ForeignKey {
  migration: string;
  table: string;
  column: string;
  onDelete: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION" | "SET DEFAULT" | "NONE";
  source: string; // the raw SQL fragment (for diagnostics)
}

/**
 * Strip /* ... *\/ block comments and -- line comments so they cannot
 * accidentally satisfy a regex match.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*\n/g, "\n");
}

/**
 * Extract the ON DELETE action from a fragment of SQL that already contains
 * a REFERENCES clause. Returns "NONE" if no ON DELETE clause is present
 * (Postgres default = NO ACTION; for our purposes that is equally wrong).
 */
function parseOnDelete(fragment: string): ForeignKey["onDelete"] {
  const m = fragment.match(/ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION|SET\s+DEFAULT)/i);
  if (!m) return "NONE";
  const normalised = m[1].toUpperCase().replace(/\s+/g, " ");
  return normalised as ForeignKey["onDelete"];
}

/**
 * Find every CREATE TABLE block, then within each block locate inline
 * `<col> ... REFERENCES ...` lines for workspace_id / user_id columns.
 *
 * Also picks up standalone `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN
 * KEY (workspace_id|user_id) REFERENCES ...` statements (used by the
 * cascade-fix migration).
 */
function extractForeignKeys(migration: string, sql: string): ForeignKey[] {
  const cleaned = stripSqlComments(sql);
  const fks: ForeignKey[] = [];

  // --- 1. Inline column references inside CREATE TABLE -------------------
  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\)\s*;/gi;
  for (const tableMatch of cleaned.matchAll(createRe)) {
    const table = tableMatch[1];
    const body = tableMatch[2];

    // Split the table body on commas that are at depth 0 (not inside parens).
    const lines = splitTopLevel(body, ",");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      // Match `<colname> <type ...> REFERENCES ...`
      const colMatch = line.match(/^(workspace_id|user_id)\b[\s\S]*?REFERENCES\b[\s\S]*$/i);
      if (!colMatch) continue;
      fks.push({
        migration,
        table,
        column: colMatch[1].toLowerCase(),
        onDelete: parseOnDelete(line),
        source: line.replace(/\s+/g, " "),
      });
    }
  }

  // --- 2. Standalone ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ------
  // We treat these as authoritative overrides: they replace whatever the
  // CREATE TABLE said (the cascade-fix migration is the canonical example).
  const alterRe =
    /ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ADD\s+CONSTRAINT\s+\w+\s+FOREIGN\s+KEY\s*\(\s*(workspace_id|user_id)\s*\)\s+REFERENCES[\s\S]*?(?=;)/gi;
  for (const m of cleaned.matchAll(alterRe)) {
    fks.push({
      migration,
      table: m[1],
      column: m[2].toLowerCase(),
      onDelete: parseOnDelete(m[0]),
      source: m[0].replace(/\s+/g, " "),
    });
  }

  return fks;
}

/**
 * Split a string on `sep` only at parenthesis depth 0. Postgres column
 * definitions can contain commas inside CHECK(...) or function calls and
 * those must not split a definition in half.
 */
function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

// ---------------------------------------------------------------------------
// Aggregate: scan every operator migration once.
// ---------------------------------------------------------------------------

function loadAllOperatorFks(): ForeignKey[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => AUDITED_MIGRATIONS.has(f))
    .sort(); // chronological order — later migrations override earlier ones

  const seen = new Map<string, ForeignKey>(); // key = `${table}.${column}`
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const fk of extractForeignKeys(file, sql)) {
      seen.set(`${fk.table}.${fk.column}`, fk);
    }
  }
  return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Operator cascade audit", () => {
  const fks = loadAllOperatorFks();

  it("discovers every operator workspace_id / user_id foreign key", () => {
    // Sanity check — if this drops to zero the regex broke or the
    // migrations directory moved. We expect at minimum one FK per known
    // operator table.
    const tables = new Set(fks.map((fk) => fk.table));
    expect(tables.has("workspace_operator_runs")).toBe(true);
    expect(tables.has("workspace_operator_prompts")).toBe(true);
    expect(tables.has("operator_api_keys")).toBe(true);
    expect(tables.has("operator_notification_preferences")).toBe(true);
  });

  it("workspace_id foreign keys all use ON DELETE CASCADE", () => {
    const offenders = fks
      .filter((fk) => fk.column === "workspace_id" && fk.onDelete !== "CASCADE")
      .map((fk) => `${fk.migration}: ${fk.table}.workspace_id => ${fk.onDelete} (expected CASCADE) :: ${fk.source}`);
    expect(offenders).toEqual([]);
  });

  it("user_id foreign keys on personal-data tables use ON DELETE CASCADE", () => {
    const offenders = fks
      .filter((fk) => fk.column === "user_id" && !USER_ID_SET_NULL_TABLES.has(fk.table) && fk.onDelete !== "CASCADE")
      .map((fk) => `${fk.migration}: ${fk.table}.user_id => ${fk.onDelete} (expected CASCADE) :: ${fk.source}`);
    expect(offenders).toEqual([]);
  });

  it("user_id foreign keys on run-history tables use ON DELETE SET NULL", () => {
    const offenders = fks
      .filter((fk) => fk.column === "user_id" && USER_ID_SET_NULL_TABLES.has(fk.table) && fk.onDelete !== "SET NULL")
      .map((fk) => `${fk.migration}: ${fk.table}.user_id => ${fk.onDelete} (expected SET NULL) :: ${fk.source}`);
    expect(offenders).toEqual([]);
  });
});
