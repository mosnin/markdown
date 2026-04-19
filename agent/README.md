# Workspace Operator

Python-based agent that runs in [Modal](https://modal.com/) and produces
reviewable knowledge artifacts (draft notes on a branch) for a user's
Poggle workspace.

This lives in the same repo as the Next.js app but deploys independently.

## Layout

```
agent/
├── pyproject.toml
├── src/workspace_operator/
│   ├── app.py           # Modal entrypoint — `modal deploy src/workspace_operator/app.py`
│   ├── operator.py      # OpenAI Agents SDK agent definition + run loop
│   ├── client.py        # httpx client for callbacks to Poggle /api/agent/tools/*
│   ├── settings.py      # env-var config
│   ├── models.py        # pydantic payloads
│   ├── tools/
│   │   ├── search.py    # hybrid_search tool
│   │   └── draft.py     # draft_note tool
│   └── guardrails/
│       └── cite.py      # [[note_id]] citation enforcement
└── tests/               # pytest
```

## Dev setup

```sh
cd agent
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"
pytest
```

## Deploying

```sh
modal secret create poggle-operator-secrets \
  POGGLE_BASE_URL=https://app.poggle.dev \
  WORKSPACE_OPERATOR_SHARED_SECRET=... \
  OPENAI_API_KEY=sk-...

modal deploy src/workspace_operator/app.py
```

Then set `WORKSPACE_OPERATOR_URL` on the Next.js side to the deployed
endpoint URL, plus `WORKSPACE_OPERATOR_SHARED_SECRET` to the same value,
and `WORKSPACE_OPERATOR_ENABLED=true`.

## Contract with Poggle

The agent receives an input envelope signed by `WORKSPACE_OPERATOR_SHARED_SECRET`
(a shared secret — rotate by updating both the Next.js env and the Modal
secret, then redeploying).

Every tool call back into Poggle passes the same secret plus a trusted
envelope (user_id, workspace_id, branch_id, run_id). The Poggle side
re-verifies both on every request — see
`src/app/api/agent/_lib/auth.ts`.
