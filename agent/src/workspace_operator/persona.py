"""Persona configuration — filters tools and applies system prompt overrides.

Personas are fetched from the DB (agent_personas table) and passed to the
operator at run start. This module takes a persona dict + the full tool
list and returns the filtered, configured pieces.

The operator module stays persona-unaware: it hands this module whatever
the server-action envelope included, and uses the returned tool list +
instructions string. A `None` persona collapses to the `default()`
factory, which is a pure pass-through.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class PersonaConfig:
    slug: str
    name: str
    system_prompt: str | None
    tool_allowlist: list[str]
    model: str | None
    max_turns: int | None
    requires_approval: bool
    plan_first: bool
    must_cite_per_claim: bool

    @classmethod
    def from_dict(cls, d: dict) -> "PersonaConfig":
        """Hydrate a persona from a DB row / JSON envelope.

        Missing keys fall back to `default()` semantics (e.g. empty
        allowlist = all tools allowed). Unknown keys are ignored so an
        older operator deploy can tolerate new persona fields.
        """
        raw_allowlist = d.get("tool_allowlist") or []
        allowlist: list[str] = [str(t) for t in raw_allowlist]
        return cls(
            slug=str(d.get("slug") or "default"),
            name=str(d.get("name") or "Default"),
            system_prompt=(
                str(d["system_prompt"])
                if d.get("system_prompt") is not None
                else None
            ),
            tool_allowlist=allowlist,
            model=(
                str(d["model"]) if d.get("model") is not None else None
            ),
            max_turns=(
                int(d["max_turns"])
                if d.get("max_turns") is not None
                else None
            ),
            requires_approval=bool(d.get("requires_approval", False)),
            plan_first=bool(d.get("plan_first", False)),
            must_cite_per_claim=bool(d.get("must_cite_per_claim", False)),
        )

    @classmethod
    def default(cls) -> "PersonaConfig":
        return cls(
            slug="default",
            name="Default",
            system_prompt=None,
            tool_allowlist=[],
            model=None,
            max_turns=None,
            requires_approval=False,
            plan_first=False,
            must_cite_per_claim=False,
        )


def _tool_name(tool: Any) -> str | None:
    """Best-effort extraction of a tool's registered name.

    The Agents SDK `@function_tool` decorator stores the override name on
    the returned object (usually `.name`); helper-returned tools (e.g.
    `Agent.as_tool`) also set `.name`. Plain functions expose `__name__`.
    """
    return getattr(tool, "name", None) or getattr(tool, "__name__", None)


def filter_tools_by_allowlist(
    tools: list[Any], tool_allowlist: list[str]
) -> list[Any]:
    """Keep only tools whose name is in `tool_allowlist`.

    An empty allowlist is treated as "no filtering" — the full tool list
    is returned unchanged. Tools that fail to expose a name (neither
    `.name` nor `__name__`) are dropped when a non-empty allowlist is
    in effect, which is the safe default.
    """
    if not tool_allowlist:
        return tools
    allowed = set(tool_allowlist)
    filtered: list[Any] = []
    for tool in tools:
        name = _tool_name(tool)
        if name is not None and name in allowed:
            filtered.append(tool)
    return filtered


def apply_persona_to_instructions(
    base_instructions: str, persona: PersonaConfig
) -> str:
    """Optionally swap the leading SYSTEM_PROMPT with the persona's.

    `base_instructions` is expected to look like
    `SYSTEM_PROMPT + "\\n\\n" + workspace_context_block` (see
    `operator._build_workspace_context_block`). When the persona sets
    `system_prompt`, we replace the leading SYSTEM_PROMPT chunk while
    preserving the workspace-context tail so prompt-cache keys for the
    context block still hit. When the persona has no override, the base
    string is returned unchanged.
    """
    if persona.system_prompt is None:
        return base_instructions
    # Split off whatever came after SYSTEM_PROMPT. The operator builds
    # the base as `SYSTEM_PROMPT + "\n\n" + workspace_context_block`, so
    # the tail is everything after the first blank-line separator.
    separator = "\n\n"
    _, sep, tail = base_instructions.partition(separator)
    preserved_tail = tail if sep else ""
    header = persona.system_prompt + "\n\n[Workspace context follows]\n"
    if preserved_tail:
        return header + preserved_tail
    return header
