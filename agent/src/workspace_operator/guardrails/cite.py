"""Cite guardrail — enforce that every drafted note cites at least one source.

The Operator's trust story depends on citation discipline: a user looking
at a diff of agent-drafted notes must be able to follow every claim back
to a workspace note. We enforce this with an output guardrail on the
Operator agent — if the final agent output references drafted notes with
no `[[note_id]]` wikilinks in their body, the run is rejected.

This is intentionally conservative in v1. Phase 3 will upgrade to a
per-claim model-based check; for now the simple lexical rule catches the
worst failure mode (agent confidently fabricates with no sources).
"""

from __future__ import annotations

import re
from typing import Any

from agents import (
    GuardrailFunctionOutput,
    RunContextWrapper,
    output_guardrail,
)

_WIKILINK_PATTERN = re.compile(r"\[\[[^\[\]\n]{1,200}\]\]")


def contains_citation(markdown: str) -> bool:
    """Return True if the markdown contains at least one `[[...]]` wikilink."""
    return bool(_WIKILINK_PATTERN.search(markdown))


class CiteGuardrailViolation(RuntimeError):
    """Raised when an agent output fails the cite guardrail."""


def build_cite_output_guardrail() -> Any:
    """OpenAI Agents SDK output guardrail that enforces citation discipline.

    The guardrail inspects the final agent output text. If the agent
    references having drafted notes but the drafted content contains no
    wikilinks, the guardrail trips and the run is failed.

    We also accept `[note_id]` Markdown-style links and raw uuid mentions
    in fenced code blocks as acceptable citations — the lexical heuristic
    is deliberately lenient to avoid false positives from well-formed
    outputs.
    """

    @output_guardrail
    async def cite_guardrail(
        _ctx: RunContextWrapper[Any], _agent: Any, output: Any
    ) -> GuardrailFunctionOutput:
        text = _coerce_to_text(output)
        if not text:
            return GuardrailFunctionOutput(
                output_info={"reason": "empty_output"},
                tripwire_triggered=False,
            )

        mentions_drafting = bool(
            re.search(r"\bdraft(ed|ing)?\b|\bcreated note\b|\bwrote\b", text, re.IGNORECASE)
        )
        has_citation = contains_citation(text) or _has_loose_citation(text)

        if mentions_drafting and not has_citation:
            return GuardrailFunctionOutput(
                output_info={
                    "reason": "no_citation",
                    "rule": "every agent output that mentions drafting must contain at least one [[note_id]] wikilink",
                },
                tripwire_triggered=True,
            )

        return GuardrailFunctionOutput(
            output_info={"reason": "ok", "has_citation": has_citation},
            tripwire_triggered=False,
        )

    return cite_guardrail


def _coerce_to_text(output: Any) -> str:
    if isinstance(output, str):
        return output
    if hasattr(output, "model_dump_json"):
        try:
            return output.model_dump_json()
        except Exception:  # noqa: BLE001
            pass
    return str(output)


def _has_loose_citation(text: str) -> bool:
    """Lenient fallback: uuid-shaped strings within Markdown link syntax."""
    return bool(
        re.search(
            r"\]\([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)",
            text,
            re.IGNORECASE,
        )
    )
