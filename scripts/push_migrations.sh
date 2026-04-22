#!/usr/bin/env bash
#
# Wrapper around `supabase db push` with a count + confirmation gate.
#
# Usage:
#   ./scripts/push_migrations.sh             # interactive, prompts for 'yes'
#   CI=1 ./scripts/push_migrations.sh        # non-interactive (skips prompt)
#   ./scripts/push_migrations.sh --dry-run   # extra args pass through to supabase
#
# Exits with whatever `supabase db push` returned.

set -euo pipefail

MIGRATIONS_DIR="supabase/migrations"

if ! command -v supabase >/dev/null 2>&1; then
  echo "error: 'supabase' CLI not found in PATH." >&2
  echo "  Install: https://supabase.com/docs/guides/local-development/cli/getting-started" >&2
  exit 127
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "error: $MIGRATIONS_DIR does not exist (run from repo root)." >&2
  exit 1
fi

# Count .sql files in the migrations directory (zero if none).
COUNT=$(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')

echo "About to push ${COUNT} migration file(s) from ${MIGRATIONS_DIR} via 'supabase db push'."

if [ -z "${CI:-}" ]; then
  printf "Are you sure? Type 'yes' to continue: "
  read -r CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
else
  echo "CI detected — skipping interactive confirmation."
fi

set +e
supabase db push "$@"
STATUS=$?
set -e

exit "$STATUS"
