"""Modal deployment entrypoint for the Workspace Operator.

Deploy with:
    cd agent && modal deploy src/workspace_operator/app.py

Serve locally with hot reload:
    cd agent && modal serve src/workspace_operator/app.py

Required secrets (configure once via `modal secret create`):
    - poggle-operator-secrets:
        POGGLE_BASE_URL
        WORKSPACE_OPERATOR_SHARED_SECRET
        OPENAI_API_KEY
        WORKSPACE_OPERATOR_MODEL (optional)
"""

from __future__ import annotations

import hmac
import json
import os

import modal
from fastapi import Header, HTTPException

from workspace_operator.models import OperatorInput, OperatorResult
from workspace_operator.operator import run_operator
from workspace_operator.settings import Settings


image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "openai-agents>=0.0.10",
        "httpx>=0.27.0",
        "pydantic>=2.8.0",
        "fastapi[standard]>=0.115.0",
    )
    .add_local_python_source("workspace_operator")
)

app = modal.App("poggle-workspace-operator")


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("poggle-operator-secrets")],
    min_containers=1,
    max_containers=10,
    buffer_containers=1,
    scaledown_window=120,
    timeout=600,
)
@modal.concurrent(max_inputs=10)
@modal.fastapi_endpoint(method="POST")
async def invoke(
    payload: dict,
    x_workspace_operator_secret: str | None = Header(default=None),
) -> dict:
    """HTTP entrypoint called by the Next.js server action.

    Validates the payload, enforces the shared-secret header matches the
    value baked into the Modal secret, runs the Operator loop, and returns
    the serialized result. Errors inside the loop are caught and returned
    as `status: "failed"` rather than raised — the caller always gets a
    structured response.
    """
    # Auth check FIRST, before any work. The expected secret is read directly
    # from env (same value Settings.from_env() requires) so a malformed
    # payload cannot be used to distinguish auth state from payload state.
    expected_secret = os.environ.get("WORKSPACE_OPERATOR_SHARED_SECRET", "")
    provided_secret = x_workspace_operator_secret or ""
    if not expected_secret or not hmac.compare_digest(
        expected_secret, provided_secret
    ):
        raise HTTPException(status_code=401, detail="unauthorized")

    settings = Settings.from_env()
    # NOTE: The shared secret is also verified on the Poggle side for every
    # tool call, so this is defense-in-depth.

    try:
        input_ = OperatorInput.model_validate(payload)
    except Exception as err:
        raise HTTPException(status_code=400, detail=f"invalid payload: {err}") from err

    result = await run_operator(input_, settings)
    return json.loads(result.model_dump_json())


# Local smoke-test entrypoint: `modal run app.py::smoke`
@app.local_entrypoint()
def smoke(prompt: str = "List the key themes across my recent notes.") -> None:
    """Run the Operator once against the configured Poggle endpoint."""
    import asyncio
    import uuid

    payload = OperatorInput(
        run_id=uuid.uuid4().hex,
        user_id="00000000-0000-0000-0000-000000000001",
        workspace_id="00000000-0000-0000-0000-000000000002",
        branch_id="00000000-0000-0000-0000-000000000003",
        box_id="00000000-0000-0000-0000-000000000004",
        prompt=prompt,
    )
    settings = Settings.from_env()
    result = asyncio.run(run_operator(payload, settings))
    print(result.model_dump_json(indent=2))
