"""Phase 4 — prompt-cache tuning + token usage extraction unit tests.

These tests pin the byte-stability invariant of the workspace context block
(same inputs -> same bytes -> OpenAI prompt-cache hit) and the tolerance of
`_extract_usage` to SDK-version drift.
"""

from __future__ import annotations

from types import SimpleNamespace

from workspace_operator.operator import (
    CONTEXT_VERSION,
    _build_workspace_context_block,
    _extract_usage,
)


# ---------------------------------------------------------------------------
# _build_workspace_context_block determinism + sorting
# ---------------------------------------------------------------------------


def test_context_block_is_deterministic() -> None:
    """Two calls with identical args return byte-identical strings."""
    a = _build_workspace_context_block(workspace_id="w-1", box_id="bx-1")
    b = _build_workspace_context_block(workspace_id="w-1", box_id="bx-1")
    assert a == b
    # Encode to bytes to guard against surprising unicode normalization.
    assert a.encode("utf-8") == b.encode("utf-8")


def test_context_block_embeds_version_and_ids() -> None:
    """The block must embed workspace_id, box_id, and CONTEXT_VERSION."""
    block = _build_workspace_context_block(workspace_id="w-abc", box_id="bx-xyz")
    assert "workspace_id: w-abc" in block
    assert "target_box_id: bx-xyz" in block
    assert f"context_version: {CONTEXT_VERSION}" in block


def test_context_block_sorts_boxes_by_name_then_id() -> None:
    """Boxes arrive unsorted; output must order by (name, id) asc."""
    boxes = [
        {"id": "b3", "name": "Zebra", "note_count": 1},
        {"id": "b1", "name": "Alpha", "note_count": 42},
        {"id": "b2", "name": "Alpha", "note_count": 7},  # name-tie -> id breaks it
    ]
    block = _build_workspace_context_block(
        workspace_id="w-1",
        box_id="b1",
        boxes=boxes,
    )
    # Find the ordered slice after the "### Boxes" header.
    lines = block.splitlines()
    boxes_start = lines.index("### Boxes") + 1
    ordered = lines[boxes_start:]
    # Expect Alpha (b1) then Alpha (b2) then Zebra (b3).
    assert ordered[0].startswith("- Alpha (b1)")
    assert ordered[1].startswith("- Alpha (b2)")
    assert ordered[2].startswith("- Zebra (b3)")


def test_context_block_input_permutation_is_identical() -> None:
    """Shuffling the boxes input must not change the rendered output."""
    boxes_a = [
        {"id": "b1", "name": "Alpha"},
        {"id": "b2", "name": "Beta"},
        {"id": "b3", "name": "Gamma"},
    ]
    boxes_b = list(reversed(boxes_a))
    out_a = _build_workspace_context_block(
        workspace_id="w", box_id="b1", boxes=boxes_a
    )
    out_b = _build_workspace_context_block(
        workspace_id="w", box_id="b1", boxes=boxes_b
    )
    assert out_a == out_b


def test_context_block_omits_boxes_section_when_none() -> None:
    """Bare envelope still produces a valid block without a Boxes section."""
    block = _build_workspace_context_block(workspace_id="w", box_id="b")
    assert "### Boxes" not in block
    # Must still end in a trailing newline for clean concatenation.
    assert block.endswith("\n")


# ---------------------------------------------------------------------------
# _extract_usage — tolerant across SDK shapes
# ---------------------------------------------------------------------------


def test_extract_usage_from_context_wrapper_usage() -> None:
    """SDK ≥0.x exposes usage on RunResult.context_wrapper.usage."""
    usage = SimpleNamespace(
        input_tokens=1234,
        output_tokens=567,
        input_tokens_details=SimpleNamespace(cached_tokens=800),
    )
    run_result = SimpleNamespace(context_wrapper=SimpleNamespace(usage=usage))
    got = _extract_usage(run_result)
    assert got == {
        "input_tokens": 1234,
        "output_tokens": 567,
        "cached_input_tokens": 800,
    }


def test_extract_usage_from_direct_usage_attr() -> None:
    """Older / streaming results may expose usage at the top level."""
    usage = SimpleNamespace(
        input_tokens=10,
        output_tokens=20,
        cached_input_tokens=5,
    )
    run_result = SimpleNamespace(usage=usage)
    got = _extract_usage(run_result)
    assert got["input_tokens"] == 10
    assert got["output_tokens"] == 20
    assert got["cached_input_tokens"] == 5


def test_extract_usage_returns_empty_when_missing() -> None:
    """No usage attribute anywhere -> empty dict -> caller defaults to 0."""
    run_result = SimpleNamespace(final_output="hi")
    assert _extract_usage(run_result) == {}


def test_extract_usage_handles_none_cached_tokens() -> None:
    """Some providers omit cached_tokens entirely; fall back to 0."""
    usage = SimpleNamespace(
        input_tokens=100,
        output_tokens=50,
        input_tokens_details=SimpleNamespace(cached_tokens=None),
    )
    run_result = SimpleNamespace(context_wrapper=SimpleNamespace(usage=usage))
    got = _extract_usage(run_result)
    assert got["cached_input_tokens"] == 0


def test_extract_usage_handles_missing_token_fields() -> None:
    """A malformed usage object without input/output tokens returns zeros."""
    run_result = SimpleNamespace(
        context_wrapper=SimpleNamespace(usage=SimpleNamespace())
    )
    got = _extract_usage(run_result)
    assert got == {
        "input_tokens": 0,
        "output_tokens": 0,
        "cached_input_tokens": 0,
    }
