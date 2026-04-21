"""`execute_code` tool — run a Python or JavaScript snippet in a sandbox.

Execution happens in a fresh `modal.Sandbox` spawned from the running
Workspace Operator app (see `workspace_operator.sandbox.run_sandboxed`).
After the run completes the tool forwards the captured result to the
Next.js audit endpoint `/api/agent/tools/execute_code` via
`PoggleClient.execute_code(...)` so the row shows up in the run
timeline. The LLM sees the same JSON shape as before — the audit hop
is invisible to the model.

Use this for short, bounded computations (parsing a blob, checking a
regex, confirming a calculation). Do NOT pipe secrets through the
snippet — the code, its stdout, and its stderr are persisted for
audit.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient
from workspace_operator.sandbox import run_sandboxed

log = logging.getLogger(__name__)


class ExecuteCodeInput(BaseModel):
    language: Literal["python", "javascript"] = Field(
        description="Interpreter to use for the snippet.",
    )
    code: str = Field(
        min_length=1,
        max_length=20000,
        description=(
            "The snippet to run. Keep it small and self-contained — the "
            "sandbox has no persistent filesystem between calls."
        ),
    )
    timeout_seconds: int = Field(
        default=15,
        ge=1,
        le=60,
        description="Hard wall-clock cap on execution (1-60s, default 15).",
    )


class ExecuteCodeOutput(BaseModel):
    stdout: str
    stderr: str
    return_value: str | None = None
    exit_code: int
    elapsed_ms: int
    execution_id: str | None = None


def build_execute_code_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="execute_code",
        description_override=(
            "Run a short code snippet in a sandboxed environment. Python "
            "and JavaScript supported. Time-limited. Returns stdout, "
            "stderr, and exit code. Useful for verifying behavior, "
            "computing, or parsing data. Do not use for secrets or "
            "long-running work."
        ),
    )
    async def execute_code(
        _ctx: RunContextWrapper[Any], args: ExecuteCodeInput
    ) -> ExecuteCodeOutput:
        # 1. Actually run the snippet in a fresh modal.Sandbox.
        sb_result = await run_sandboxed(
            language=args.language,
            code=args.code,
            timeout_seconds=float(args.timeout_seconds),
        )

        # 2. Forward the computed result to Next.js for audit logging.
        #    Failures here must not mask the real execution — log and
        #    fall through with a null execution_id.
        execution_id: str | None = None
        try:
            audit = await client.execute_code(
                language=args.language,
                code=args.code,
                stdout=sb_result.stdout,
                stderr=sb_result.stderr,
                return_value=None,
                exit_code=sb_result.exit_code,
                elapsed_ms=sb_result.elapsed_ms,
                truncated=sb_result.truncated,
                error=sb_result.error,
            )
            raw_id = audit.get("execution_id") if isinstance(audit, dict) else None
            if raw_id is not None:
                execution_id = str(raw_id)
        except Exception:  # noqa: BLE001
            log.warning("execute_code audit POST failed", exc_info=True)

        # 3. Return the same shape the LLM has been seeing. Any sandbox
        #    layer error is surfaced via stderr so the model can react.
        stderr_out = sb_result.stderr
        if sb_result.error is not None:
            suffix = f"[sandbox {sb_result.error}]"
            stderr_out = f"{stderr_out}\n{suffix}" if stderr_out else suffix

        return ExecuteCodeOutput(
            stdout=sb_result.stdout,
            stderr=stderr_out,
            return_value=None,
            exit_code=sb_result.exit_code,
            elapsed_ms=sb_result.elapsed_ms,
            execution_id=execution_id,
        )

    return execute_code
