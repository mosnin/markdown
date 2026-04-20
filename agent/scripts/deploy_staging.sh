#!/usr/bin/env bash
#
# deploy_staging.sh — Deploy the Workspace Operator (poggle-operator) Modal
# app to the `staging` Modal environment.
#
# Prerequisites (one-time setup):
#   1. `modal token new`                              — auth this machine to Modal.
#   2. `modal environment create staging`             — if `staging` doesn't exist.
#   3. `modal secret create poggle-operator-secrets   — see DEPLOY.md for vars.
#         POGGLE_BASE_URL=...
#         WORKSPACE_OPERATOR_SHARED_SECRET=...
#         OPENAI_API_KEY=sk-...
#         WORKSPACE_OPERATOR_MODEL=gpt-4.1-mini       (optional)
#         WORKSPACE_OPERATOR_HTTP_TIMEOUT_S=30        (optional)
#         WORKSPACE_OPERATOR_MAX_TOOL_CALLS=20        (optional)
#         --env staging`
#
# Usage:
#   bash agent/scripts/deploy_staging.sh
#
# Environment overrides:
#   MODAL_ENVIRONMENT  — defaults to "staging"
#   MODAL_APP_NAME     — defaults to "poggle-workspace-operator" (matches app.py)
#
# After deploy, the script prints the endpoint URL. Plug it into
# WORKSPACE_OPERATOR_URL on the Next.js side and verify with
# `bash agent/scripts/smoke_test.sh`.

set -euo pipefail

MODAL_ENVIRONMENT="${MODAL_ENVIRONMENT:-staging}"
MODAL_APP_NAME="${MODAL_APP_NAME:-poggle-workspace-operator}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v modal >/dev/null 2>&1; then
  echo "[deploy_staging] modal CLI not found on PATH. Install with:"
  echo "    pip install modal>=0.66.0"
  exit 1
fi

echo "[deploy_staging] env=${MODAL_ENVIRONMENT} app=${MODAL_APP_NAME}"
echo "[deploy_staging] verifying Modal secret 'poggle-operator-secrets' exists in env..."
if ! modal secret list --env "${MODAL_ENVIRONMENT}" 2>/dev/null | grep -q "poggle-operator-secrets"; then
  echo "[deploy_staging] ERROR: secret 'poggle-operator-secrets' not found in env '${MODAL_ENVIRONMENT}'."
  echo "[deploy_staging] See agent/DEPLOY.md for the modal secret create command."
  exit 1
fi

cd "${AGENT_DIR}"

echo "[deploy_staging] running 'modal deploy' ..."
modal deploy \
  --env "${MODAL_ENVIRONMENT}" \
  --name "${MODAL_APP_NAME}" \
  src/workspace_operator/app.py

echo
echo "[deploy_staging] done. Endpoint URL printed above (look for the line"
echo "                 containing 'invoke' under 'Web endpoints')."
echo "[deploy_staging] Next: export WORKSPACE_OPERATOR_URL=<that url> and"
echo "                       bash agent/scripts/smoke_test.sh"
