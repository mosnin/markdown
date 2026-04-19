"""Runtime settings for the Workspace Operator.

Loaded from process env on Modal. Kept deliberately flat — no YAML, no
config files — so Modal secrets are the single source of truth.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    poggle_base_url: str
    shared_secret: str
    openai_api_key: str
    model: str
    request_timeout_s: float
    max_tool_calls: int

    @classmethod
    def from_env(cls) -> Settings:
        base = _require_env("POGGLE_BASE_URL").rstrip("/")
        return cls(
            poggle_base_url=base,
            shared_secret=_require_env("WORKSPACE_OPERATOR_SHARED_SECRET"),
            openai_api_key=_require_env("OPENAI_API_KEY"),
            model=os.environ.get("WORKSPACE_OPERATOR_MODEL", "gpt-4.1-mini"),
            request_timeout_s=float(os.environ.get("WORKSPACE_OPERATOR_HTTP_TIMEOUT_S", "30")),
            max_tool_calls=int(os.environ.get("WORKSPACE_OPERATOR_MAX_TOOL_CALLS", "20")),
        )


def _require_env(key: str) -> str:
    value = os.environ.get(key)
    if not value or not value.strip():
        raise RuntimeError(
            f"[operator.settings] missing required env var: {key}. "
            "Configure it in the Modal secret bound to the agent app."
        )
    return value.strip()
