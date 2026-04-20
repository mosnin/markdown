# Workspace Operator — Modal Deployment Runbook

How to deploy the `poggle-workspace-operator` Modal app to a `staging`
Modal environment, smoke-test it, roll it back, and view its logs.

This runbook covers the gap called out in `docs/modal_agent.md`:
> No end-to-end smoke test against a deployed Modal endpoint.
> Staging deploy is next step.

The Modal entrypoint lives at `agent/src/workspace_operator/app.py`. The
runtime config is loaded from process env by `Settings.from_env()` in
`agent/src/workspace_operator/settings.py` — those env vars are the
single source of truth and must be present in the Modal secret.

---

## 1. One-time prerequisites

- A Modal account and `modal` CLI installed locally (`pip install
  'modal>=0.66.0'`).
- `modal token new` — auths this machine.
- `modal environment create staging` — create the environment if it
  doesn't already exist. (`modal environment list` to check.)
- An OpenAI API key with access to the configured model (default
  `gpt-4.1-mini`).
- Network access to the Poggle Next.js deployment that the agent will
  call back into — the value going into `POGGLE_BASE_URL`.

## 2. Required Modal secret

The Modal app binds a single secret named **`poggle-operator-secrets`**.
It must contain the env vars below. Names match `settings.py` exactly —
do not rename them.

| Env var                              | Required | Default          | Source                                         |
|--------------------------------------|----------|------------------|------------------------------------------------|
| `POGGLE_BASE_URL`                    | yes      | (none)           | The public URL of the Poggle Next.js deploy.   |
| `WORKSPACE_OPERATOR_SHARED_SECRET`   | yes      | (none)           | Random 32+ char secret. Must match the value in the Next.js env so `/api/agent/tools/*` accepts callbacks. |
| `OPENAI_API_KEY`                     | yes      | (none)           | OpenAI key with access to the configured model. |
| `WORKSPACE_OPERATOR_MODEL`           | no       | `gpt-4.1-mini`   | OpenAI model id.                               |
| `WORKSPACE_OPERATOR_HTTP_TIMEOUT_S`  | no       | `30`             | httpx timeout for Poggle callbacks.            |
| `WORKSPACE_OPERATOR_MAX_TOOL_CALLS`  | no       | `20`             | Hard cap on tool calls per run (mapped to SDK `max_turns`). |

> **Billing note.** `CREEM_*` product ids and `POGGLE_API_TOKEN` live on
> the Next.js side, not in this Modal secret. The Modal agent never
> talks to Creem directly — it reports usage back through the Poggle
> Next.js endpoints which then bill via Creem. Do **not** put `CREEM_*`
> into `poggle-operator-secrets`.

### Create or update the secret

```bash
# First-time create:
modal secret create poggle-operator-secrets \
  --env staging \
  POGGLE_BASE_URL='https://poggle-staging.example.com' \
  WORKSPACE_OPERATOR_SHARED_SECRET='replace-me-with-32-char-random' \
  OPENAI_API_KEY='sk-...' \
  WORKSPACE_OPERATOR_MODEL='gpt-4.1-mini' \
  WORKSPACE_OPERATOR_HTTP_TIMEOUT_S='30' \
  WORKSPACE_OPERATOR_MAX_TOOL_CALLS='20'

# Update an existing secret (Modal: delete + recreate; there is no
# `modal secret update` as of 0.66.x):
modal secret delete poggle-operator-secrets --env staging
modal secret create  poggle-operator-secrets --env staging  ...as above...
```

Verify:

```bash
modal secret list --env staging
modal secret show poggle-operator-secrets --env staging   # masks values
```

## 3. Deploy

```bash
bash agent/scripts/deploy_staging.sh
# or, equivalently:
cd agent && modal deploy --env staging --name poggle-workspace-operator \
  src/workspace_operator/app.py
```

The deploy script:
1. Verifies `modal` is on `PATH`.
2. Verifies `poggle-operator-secrets` exists in the target env (fails
   loudly if not — a deploy without the secret would crash on first
   request).
3. Runs `modal deploy`.

After deploy, Modal prints a section named **Web endpoints**. Copy the
URL ending in `/invoke` — that is `WORKSPACE_OPERATOR_URL`.

```bash
export WORKSPACE_OPERATOR_URL='https://<workspace>--poggle-workspace-operator-invoke.modal.run'
```

Set the same value in the Next.js staging env so the server action knows
where to dispatch.

## 4. Smoke test the deployed endpoint

```bash
export WORKSPACE_OPERATOR_URL='https://<...>.modal.run'
export WORKSPACE_OPERATOR_SHARED_SECRET='<same value as the Modal secret>'
export SMOKE_USER_ID='<a real user uuid>'
export SMOKE_WORKSPACE_ID='<a real workspace uuid>'
export SMOKE_BRANCH_ID='<a draft branch uuid in that workspace>'
export SMOKE_BOX_ID='<a box uuid in that workspace>'

bash agent/scripts/smoke_test.sh
```

Defaults to **plan mode** (the safest target — read-only tools only;
will not create notes). Override with `SMOKE_MODE=full` for a real
end-to-end write. Override `SMOKE_PROMPT` to test specific behaviour.

The script POSTs to `${WORKSPACE_OPERATOR_URL}` with the envelope
headers (`x-workspace-operator-secret`, `-user-id`, `-workspace-id`,
`-branch-id`, `-run-id`) and the JSON body the Modal endpoint expects
(see `OperatorInput` in `models.py`). It exits non-zero on any non-2xx
response.

A successful response looks like:

```json
{
  "run_id": "smoke-1718640000-12345",
  "status": "completed",
  "notes_created": [],
  "tool_calls": 2,
  "plan": { "steps": [...], "summary": "..." },
  "input_tokens": 1234, "output_tokens": 456, "cached_input_tokens": 800,
  "model": "gpt-4.1-mini"
}
```

## 5. View logs

```bash
# Live log tail (most recent function invocations):
modal app logs poggle-workspace-operator --env staging

# Filter by function name (useful once we add more functions):
modal app logs poggle-workspace-operator --env staging --function invoke

# Just the most recent N lines:
modal app logs poggle-workspace-operator --env staging --tail 200
```

For container-level / build issues use `modal app history
poggle-workspace-operator --env staging`.

## 6. Rollback

Modal does not have first-class versioned rollback for `modal deploy`.
The supported rollback paths are:

```bash
# Stop the app entirely (zero-downtime rollback to "off" — Next.js
# server action will receive 5xx and surface a "agent unavailable"
# error to the user). Use this if the deploy is actively misbehaving.
modal app stop poggle-workspace-operator --env staging

# Re-deploy the previous git ref:
git checkout <previous-good-sha>
bash agent/scripts/deploy_staging.sh
git checkout -    # back to whatever you had

# Resume after a stop:
bash agent/scripts/deploy_staging.sh   # `modal deploy` revives the app
```

The Modal secret (`poggle-operator-secrets`) is not touched by deploy
or stop, so rolling code back will not affect env vars or accidentally
expose stale credentials.

## 7. Production deploy

Same flow with `MODAL_ENVIRONMENT=production`:

```bash
modal environment create production           # one-time
modal secret create poggle-operator-secrets   # with PROD values
  --env production ...
MODAL_ENVIRONMENT=production bash agent/scripts/deploy_staging.sh
```

The script's name says "staging" because that is the default; the
`MODAL_ENVIRONMENT` env var overrides.

## 8. Troubleshooting

| Symptom                                            | Likely cause / fix                                                                                                  |
|----------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|
| Deploy fails with `secret 'poggle-operator-secrets' not found` | Run the `modal secret create` command in section 2 against the target env.                              |
| First request returns `RuntimeError: missing required env var: POGGLE_BASE_URL` | Secret exists but lacks one of the required keys. Recreate it with all required keys.   |
| Smoke test returns 401 / 403 from Poggle callbacks | `WORKSPACE_OPERATOR_SHARED_SECRET` in the Modal secret does not match the Next.js env.                              |
| Smoke test returns 5xx from Modal                  | Tail logs (`modal app logs ... --tail 200`). Most common: OpenAI key invalid, or Poggle base URL not reachable from Modal. |
| Run completes but `notes_created` is empty in `full` mode | Cite guardrail tripped; check the `error` field in the response and the log line `cite guardrail tripped`. |
| Long latency on first request after a quiet period | Cold start. `min_containers=1` keeps one warm; bump if the first-request latency is unacceptable.                   |
