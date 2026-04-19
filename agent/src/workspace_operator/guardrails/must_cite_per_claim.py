"""Model-based output guardrail — every factual claim must be cited.

The Phase 1 cite guardrail in `cite.py` is a lexical heuristic: it trips
only when the agent says it drafted something *and* the output contains
zero `[[note_id]]` wikilinks. That is the bare minimum and misses the
much more common failure: an output that contains *some* citations but
weaves uncited assertions in around them.

This guardrail upgrades the check by deferring to a small/cheap model
(default: gpt-4.1-mini) that scans the output for factual claims and
checks whether each one has a `[[note_id]]` wikilink or a Markdown
link to a uuid nearby. The checker returns structured JSON; we trip the
tripwire when it reports `all_cited: false`.

Design notes:

- The guardrail is **opt-in** via `OperatorInput.must_cite_per_claim`.
  The default Operator agent only attaches the lexical guardrail.
- We default to **passing** on malformed checker output (a wedge in the
  checker model must not silently fail otherwise-good runs).
- The checker prompt deliberately accepts a generous definition of
  "near" so well-formed but compact prose ("[[note-1]] confirms X.")
  doesn't trip every claim.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from agents import (
    Agent,
    GuardrailFunctionOutput,
    RunContextWrapper,
    Runner,
    output_guardrail,
)

log = logging.getLogger(__name__)


_CHECKER_PROMPT = """\
You evaluate whether an assistant's OUTPUT adequately cites its sources.

A "factual claim" is any specific assertion of fact: dates, numbers,
names, events, attributions, summaries of source material. Statements
like "I will draft a note", "Search returned no results", or generic
framing prose are NOT factual claims.

A claim is "cited" when the same paragraph (or the immediately
surrounding sentence) contains:
  - a `[[note_id]]` wikilink, OR
  - a Markdown link whose URL is a uuid (e.g. `](abcd1234-...)`).

Return ONLY a JSON object on a single line, no prose, no fences:

{"all_cited": true, "uncited_claims": []}

If any factual claim lacks a nearby citation, set "all_cited" to false
and list the offending claims (verbatim, max 3) in "uncited_claims".

If the OUTPUT contains no factual claims at all, return
{"all_cited": true, "uncited_claims": []}.
"""


_CHECKER_MODEL = "gpt-4.1-mini"


def _build_checker() -> Agent:
    """Construct the checker agent. Kept as a function so tests can patch."""
    return Agent(
        name="cite_per_claim_checker",
        model=_CHECKER_MODEL,
        instructions=_CHECKER_PROMPT,
    )


def _coerce_to_text(output: Any) -> str:
    if isinstance(output, str):
        return output
    if hasattr(output, "model_dump_json"):
        try:
            return output.model_dump_json()
        except Exception:  # noqa: BLE001
            pass
    return str(output)


_FENCED_JSON_RE = re.compile(r"```(?:json)?\s*\n?(.*?)```", re.DOTALL)


def _parse_checker_output(raw: Any) -> dict | None:
    """Extract the checker's JSON verdict from its final_output.

    Returns None on unparseable input — callers default to passing in
    that case so a checker wedge never silently fails good runs.
    """
    text = _coerce_to_text(raw)
    if not text or not text.strip():
        return None

    # 1. Direct JSON parse
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # 2. Fenced code block
    fenced = _FENCED_JSON_RE.search(text)
    if fenced:
        try:
            parsed = json.loads(fenced.group(1))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    # 3. First brace-balanced object in free text
    start = text.find("{")
    if start == -1:
        return None
    for end in range(len(text), start, -1):
        try:
            parsed = json.loads(text[start:end])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def build_must_cite_per_claim_guardrail() -> Any:
    """OpenAI Agents SDK output guardrail powered by a checker model.

    The checker is a small Agent (`gpt-4.1-mini` by default) that
    classifies the agent's output as fully-cited or not. The tripwire
    fires when the checker explicitly reports `all_cited: false`. Any
    other condition (empty output, malformed JSON, checker error) is
    treated as a pass — this is a soft guardrail, not a runtime gate.
    """

    @output_guardrail
    async def must_cite_per_claim(
        _ctx: RunContextWrapper[Any], _agent: Any, output: Any
    ) -> GuardrailFunctionOutput:
        text = _coerce_to_text(output)
        if not text.strip():
            return GuardrailFunctionOutput(
                output_info={"reason": "empty_output"},
                tripwire_triggered=False,
            )

        try:
            checker = _build_checker()
            run_result = await Runner.run(checker, text)
            parsed = _parse_checker_output(getattr(run_result, "final_output", ""))
        except Exception as err:  # noqa: BLE001
            log.warning("[must_cite_per_claim] checker failed: %s", err)
            return GuardrailFunctionOutput(
                output_info={"reason": "checker_error", "error": str(err)},
                tripwire_triggered=False,
            )

        if parsed is None:
            return GuardrailFunctionOutput(
                output_info={"reason": "unparseable_checker_output"},
                tripwire_triggered=False,
            )

        all_cited = parsed.get("all_cited", True)
        uncited = parsed.get("uncited_claims", []) or []

        if all_cited is False:
            return GuardrailFunctionOutput(
                output_info={
                    "reason": "uncited_claims",
                    "uncited_claims": uncited[:5] if isinstance(uncited, list) else [],
                    "rule": "every factual claim must have a [[note_id]] or uuid Markdown link nearby",
                },
                tripwire_triggered=True,
            )

        return GuardrailFunctionOutput(
            output_info={"reason": "ok", "checker_verdict": parsed},
            tripwire_triggered=False,
        )

    return must_cite_per_claim
