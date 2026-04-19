"""Unit tests for the Poggle HTTP client."""

from __future__ import annotations

import httpx
import pytest
import respx

from workspace_operator.client import PoggleAPIError, PoggleClient


BASE_URL = "https://poggle.test"
ENVELOPE = dict(
    shared_secret="s" * 40,
    user_id="00000000-0000-0000-0000-000000000001",
    workspace_id="11111111-1111-1111-1111-111111111111",
    branch_id="22222222-2222-2222-2222-222222222222",
    run_id="abcdef1234567890",
)


async def _make_client() -> PoggleClient:
    return PoggleClient(base_url=BASE_URL, **ENVELOPE)


@respx.mock
async def test_hybrid_search_unwraps_envelope() -> None:
    respx.post(f"{BASE_URL}/api/agent/tools/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "run_id": ENVELOPE["run_id"],
                    "query": "roadmap",
                    "limit": 10,
                    "results": [
                        {
                            "note_id": "n1",
                            "title": "Q1 roadmap",
                            "snippet": "...",
                            "similarity": 0.91,
                            "keyword_score": 0.3,
                            "combined_score": 0.72,
                            "match_type": "both",
                        }
                    ],
                },
                "meta": {"request_id": "abc", "api_version": "v1"},
            },
        )
    )

    async with await _make_client() as client:
        results = await client.hybrid_search("roadmap")

    assert len(results) == 1
    assert results[0].note_id == "n1"
    assert results[0].match_type == "both"


@respx.mock
async def test_hybrid_search_forwards_envelope_headers() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/search").mock(
        return_value=httpx.Response(200, json={"data": {"results": []}, "meta": {}})
    )

    async with await _make_client() as client:
        await client.hybrid_search("anything")

    assert route.called
    req = route.calls.last.request
    assert req.headers["x-workspace-operator-secret"] == ENVELOPE["shared_secret"]
    assert req.headers["x-workspace-operator-user-id"] == ENVELOPE["user_id"]
    assert req.headers["x-workspace-operator-workspace-id"] == ENVELOPE["workspace_id"]
    assert req.headers["x-workspace-operator-branch-id"] == ENVELOPE["branch_id"]
    assert req.headers["x-workspace-operator-run-id"] == ENVELOPE["run_id"]


@respx.mock
async def test_draft_note_returns_typed_result() -> None:
    respx.post(f"{BASE_URL}/api/agent/tools/draft_note").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "run_id": ENVELOPE["run_id"],
                    "note_id": "note-xyz",
                    "title": "Q1 roadmap brief",
                    "branch_id": ENVELOPE["branch_id"],
                },
                "meta": {},
            },
        )
    )

    async with await _make_client() as client:
        result = await client.draft_note(
            box_id="box-1",
            title="Q1 roadmap brief",
            markdown_content="# Roadmap\n\nSee [[note-1]]",
        )

    assert result.note_id == "note-xyz"
    assert result.title == "Q1 roadmap brief"
    assert result.branch_id == ENVELOPE["branch_id"]


@respx.mock
async def test_api_error_raises_poggle_api_error() -> None:
    respx.post(f"{BASE_URL}/api/agent/tools/draft_note").mock(
        return_value=httpx.Response(
            409,
            json={
                "error_code": "branch_not_open",
                "message": "Branch not found or not open",
                "request_id": "abc",
            },
        )
    )

    async with await _make_client() as client:
        with pytest.raises(PoggleAPIError) as excinfo:
            await client.draft_note(
                box_id="box-1",
                title="Anything",
                markdown_content="body",
            )

    assert excinfo.value.status == 409
    assert excinfo.value.error_code == "branch_not_open"
    assert "Branch not found" in excinfo.value.message


@respx.mock
async def test_unexpected_envelope_raises() -> None:
    respx.post(f"{BASE_URL}/api/agent/tools/search").mock(
        return_value=httpx.Response(200, json={"oops": True})
    )
    async with await _make_client() as client:
        with pytest.raises(PoggleAPIError):
            await client.hybrid_search("query")
