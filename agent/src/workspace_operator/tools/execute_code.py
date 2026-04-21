"""`execute_code` tool — run a Python or JavaScript snippet in a sandbox.

The actual sandbox lives behind the Next.js route
`/api/agent/tools/execute_code`, which dispatches to a Modal container.
The agent never talks to the sandbox directly — that way the secret
bearer-envelope stays on the Next.js side and the Modal operator
doesn't need to hold sandbox credentials.

Use this for short, bounded computations (parsing a blob, checking a
regex, confirming a calculation). Do NOT pipe secrets through the
snippet — the code and its stdout are persisted to
`agent_code_executions` for audit.
"""

from __future__ import annotations

from typing import Any, Literal

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


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
        result = await client.execute_code(
            language=args.language,
            code=args.code,
            timeout_seconds=args.timeout_seconds,
        )
        return ExecuteCodeOutput(
            stdout=str(result.get("stdout") or ""),
            stderr=str(result.get("stderr") or ""),
            return_value=(
                str(result["return_value"])
                if result.get("return_value") is not None
                else None
            ),
            exit_code=int(result.get("exit_code") or 0),
            elapsed_ms=int(result.get("elapsed_ms") or 0),
            execution_id=(
                str(result["execution_id"])
                if result.get("execution_id") is not None
                else None
            ),
        )

    return execute_code
