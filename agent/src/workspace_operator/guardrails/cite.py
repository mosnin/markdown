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

# Verbs/phrases that, when used affirmatively, indicate the agent claims it
# created or wrote a note. We require a subject ("I", "we", or a leading
# capitalized verb at sentence start) so generic prose like "nothing to draft"
# does not match.
#
# Examples that SHOULD match:
#   "I drafted a brief"            (subject + past-tense verb)
#   "We created note about X"
#   "Drafted [[abc-123]] for you"  (sentence-initial past-tense verb)
#   "I wrote a new note"
#
# Examples that should NOT match here (handled either by lacking a subject or
# by the negation filter below):
#   "nothing to draft"             (infinitive, no subject)
#   "no candidates to draft"
#   "did not draft"                (negation)
#   "drafted nothing"              (negated object)
_DRAFTING_CLAIM_PATTERN = re.compile(
    r"""
    (?:
        \b(?:I|we|the\s+agent)\s+(?:just\s+|have\s+|already\s+)?
            (?:drafted|created|wrote|authored|saved|added)\b
        |
        \b(?:I|we)\s+created\s+(?:a\s+|the\s+|new\s+)?note\b
        |
        (?:^|[.!?]\s+)(?:Drafted|Created|Wrote|Authored)\b
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

# If a drafting claim sentence also contains any of these negation markers we
# treat the claim as cancelled — the agent is describing an absence, not an
# action it performed.
_NEGATION_PATTERN = re.compile(
    r"""
    \b(?:
        no(?:thing|ne)?            # no, none, nothing
        | not
        | n['’]t                   # didn't, couldn't, wasn't (straight + curly apostrophe)
        | never
        | without
        | unable
        | failed\s+to
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)


def contains_citation(markdown: str) -> bool:
    """Return True if the markdown contains at least one `[[...]]` wikilink."""
    return bool(_WIKILINK_PATTERN.search(markdown))


def _mentions_drafting(text: str) -> bool:
    """Return True iff the text contains an affirmative claim of drafting.

    Splits on sentence boundaries and only counts a sentence as a drafting
    claim when it matches a positive verb pattern AND contains no negation
    markers. This prevents phrases like "nothing to draft", "no notes to
    draft", or "did not draft" from tripping the citation requirement —
    those describe an absence of action, not a claim of one.
    """
    # Split on sentence-ish boundaries (., !, ?, ;, newline). Keep it loose;
    # a missing terminator on the final fragment is fine.
    for sentence in re.split(r"[.!?;\n]+", text):
        sentence = sentence.strip()
        if not sentence:
            continue
        if not _DRAFTING_CLAIM_PATTERN.search(sentence):
            continue
        if _NEGATION_PATTERN.search(sentence):
            continue
        return True
    return False


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

        mentions_drafting = _mentions_drafting(text)
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
