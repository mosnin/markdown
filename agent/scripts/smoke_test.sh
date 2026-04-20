#!/usr/bin/env bash
#
# smoke_test.sh — Hit the deployed Workspace Operator endpoint with a minimal
# valid plan-mode request and print the response.
#
# Plan mode (default) is the safest smoke target: it only invokes
# `hybrid_search` / `read_note` / `web_fetch`, never writes notes.
#
# Required env vars:
#   WORKSPACE_OPERATOR_URL              — the deployed Modal /invoke URL
#   WORKSPACE_OPERATOR_SHARED_SECRET    — must match the Modal secret value
#   SMOKE_USER_ID                       — a real user uuid in the workspace
#   SMOKE_WORKSPACE_ID                  — workspace uuid the user belongs to
#   SMOKE_BRANCH_ID                     — a draft branch uuid in the workspace
#   SMOKE_BOX_ID                        — a box uuid in the workspace
#
# Optional:
#   SMOKE_RUN_ID    — defaults to a fresh hex string
#   SMOKE_PROMPT    — defaults to a benign "list themes" prompt
#   SMOKE_MODE      — "plan" (default) | "execute" | "full"
#
# Exits non-zero if curl reports any error or the response status is non-2xx.

set -euo pipefail

: "${WORKSPACE_OPERATOR_URL:?set WORKSPACE_OPERATOR_URL to the deployed Modal endpoint}"
: "${WORKSPACE_OPERATOR_SHARED_SECRET:?set WORKSPACE_OPERATOR_SHARED_SECRET to the Modal secret value}"
: "${SMOKE_USER_ID:?set SMOKE_USER_ID to a real user uuid}"
: "${SMOKE_WORKSPACE_ID:?set SMOKE_WORKSPACE_ID to a real workspace uuid}"
: "${SMOKE_BRANCH_ID:?set SMOKE_BRANCH_ID to a real branch uuid}"
: "${SMOKE_BOX_ID:?set SMOKE_BOX_ID to a real box uuid}"

SMOKE_RUN_ID="${SMOKE_RUN_ID:-smoke-$(date +%s)-$RANDOM$RANDOM}"
SMOKE_PROMPT="${SMOKE_PROMPT:-List the key themes across my recent notes.}"
SMOKE_MODE="${SMOKE_MODE:-plan}"

# Build JSON body without relying on jq — embed raw values, escaping double
# quotes inside SMOKE_PROMPT.
escaped_prompt="${SMOKE_PROMPT//\"/\\\"}"

body=$(cat <<EOF
{
  "run_id": "${SMOKE_RUN_ID}",
  "user_id": "${SMOKE_USER_ID}",
  "workspace_id": "${SMOKE_WORKSPACE_ID}",
  "branch_id": "${SMOKE_BRANCH_ID}",
  "box_id": "${SMOKE_BOX_ID}",
  "prompt": "${escaped_prompt}",
  "mode": "${SMOKE_MODE}"
}
EOF
)

echo "[smoke_test] POST ${WORKSPACE_OPERATOR_URL}"
echo "[smoke_test] mode=${SMOKE_MODE} run_id=${SMOKE_RUN_ID}"
echo "[smoke_test] body:"
echo "${body}"
echo

http_code=$(
  curl --silent --show-error \
    --output /tmp/smoke_test_response.json \
    --write-out '%{http_code}' \
    --max-time 600 \
    -X POST "${WORKSPACE_OPERATOR_URL}" \
    -H "content-type: application/json" \
    -H "x-workspace-operator-secret: ${WORKSPACE_OPERATOR_SHARED_SECRET}" \
    -H "x-workspace-operator-user-id: ${SMOKE_USER_ID}" \
    -H "x-workspace-operator-workspace-id: ${SMOKE_WORKSPACE_ID}" \
    -H "x-workspace-operator-branch-id: ${SMOKE_BRANCH_ID}" \
    -H "x-workspace-operator-run-id: ${SMOKE_RUN_ID}" \
    --data "${body}"
)

echo "[smoke_test] HTTP ${http_code}"
echo "[smoke_test] response:"
cat /tmp/smoke_test_response.json
echo

if [[ "${http_code}" -lt 200 || "${http_code}" -ge 300 ]]; then
  echo "[smoke_test] FAIL: non-2xx response"
  exit 1
fi

echo "[smoke_test] OK"
