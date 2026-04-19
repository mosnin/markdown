"""Unit tests for the cite output guardrail."""

from __future__ import annotations

import pytest

from workspace_operator.guardrails.cite import (
    build_cite_output_guardrail,
    contains_citation,
)


def test_contains_citation_accepts_wikilinks() -> None:
    assert contains_citation("Per [[note-abc]] we know that...")


def test_contains_citation_rejects_plain_prose() -> None:
    assert not contains_citation("Per our notes we know that...")


def test_contains_citation_rejects_empty_brackets() -> None:
    assert not contains_citation("This is []]text with [] brackets.")


async def _invoke_guardrail(output: str) -> tuple[bool, dict]:
    g = build_cite_output_guardrail()
    # The OpenAI Agents SDK wraps guardrails into a helper with a `.run`
    # method at SDK ingestion time. Call the underlying async function
    # directly for unit testing.
    inner = getattr(g, "guardrail_function", None) or getattr(g, "_func", None) or g
    result = await inner(None, None, output)
    return result.tripwire_triggered, result.output_info or {}


@pytest.mark.asyncio
async def test_guardrail_trips_when_drafting_claimed_without_citation() -> None:
    tripped, info = await _invoke_guardrail(
        "I drafted a brief about the roadmap based on what I found."
    )
    assert tripped is True
    assert info["reason"] == "no_citation"


@pytest.mark.asyncio
async def test_guardrail_passes_when_citation_present() -> None:
    tripped, _info = await _invoke_guardrail(
        "I drafted a brief based on [[note-abc]] and [[note-xyz]]."
    )
    assert tripped is False


@pytest.mark.asyncio
async def test_guardrail_passes_when_output_does_not_mention_drafting() -> None:
    tripped, _info = await _invoke_guardrail(
        "Search returned no relevant notes; nothing to draft."
    )
    assert tripped is False


@pytest.mark.asyncio
async def test_guardrail_passes_with_loose_citation_uuid() -> None:
    tripped, _info = await _invoke_guardrail(
        "I wrote a new note citing source [here](00000000-0000-0000-0000-000000000001)."
    )
    assert tripped is False
