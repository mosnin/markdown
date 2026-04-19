"""Unit tests for the Phase 3 PoggleClient tool methods.

Each test mocks the Next.js endpoint with `respx`, exercises one
PoggleClient method, and asserts the URL, body, and unwrapped return
value. Mirrors the conventions in `test_client.py`.
"""

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


def _make_client() -> PoggleClient:
    return PoggleClient(base_url=BASE_URL, **ENVELOPE)


# ---------------------------------------------------------------------------
# read_note
# ---------------------------------------------------------------------------


@respx.mock
async def test_read_note_unwraps_envelope_and_posts_body() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/read_note").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "run_id": ENVELOPE["run_id"],
                    "note_id": "note-1",
                    "title": "Hello",
                    "content": "world",
                    "branch_id": ENVELOPE["branch_id"],
                    "version": "ver-1",
                },
                "meta": {"request_id": "abc", "api_version": "v1"},
            },
        )
    )

    async with _make_client() as client:
        result = await client.read_note(note_id="note-1")

    assert route.called
    body = route.calls.last.request.read().decode()
    assert '"note_id":"note-1"' in body or '"note_id": "note-1"' in body
    assert result["note_id"] == "note-1"
    assert result["title"] == "Hello"
    assert result["content"] == "world"
    assert result["branch_id"] == ENVELOPE["branch_id"]
    assert result["version"] == "ver-1"


@respx.mock
async def test_read_note_propagates_envelope_headers() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/read_note").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {"note_id": "n", "title": "t", "content": "c"},
                "meta": {},
            },
        )
    )
    async with _make_client() as client:
        await client.read_note(note_id="n")
    req = route.calls.last.request
    assert req.headers["x-workspace-operator-secret"] == ENVELOPE["shared_secret"]
    assert req.headers["x-workspace-operator-branch-id"] == ENVELOPE["branch_id"]


# ---------------------------------------------------------------------------
# edit_note
# ---------------------------------------------------------------------------


@respx.mock
async def test_edit_note_posts_body_and_returns_version() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/edit_note").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "run_id": ENVELOPE["run_id"],
                    "note_id": "note-9",
                    "branch_id": ENVELOPE["branch_id"],
                    "version_id": "ver-7",
                    "version_number": 5,
                },
                "meta": {},
            },
        )
    )

    async with _make_client() as client:
        result = await client.edit_note(
            note_id="note-9",
            new_content="new body",
            edit_summary="reason",
        )

    assert route.called
    sent = route.calls.last.request.read().decode()
    assert "note-9" in sent and "new body" in sent and "reason" in sent
    assert result["note_id"] == "note-9"
    assert result["version_id"] == "ver-7"
    assert result["version_number"] == 5


@respx.mock
async def test_edit_note_raises_on_branch_not_open() -> None:
    respx.post(f"{BASE_URL}/api/agent/tools/edit_note").mock(
        return_value=httpx.Response(
            409,
            json={
                "error_code": "branch_not_open",
                "message": "Branch not found or not open",
                "request_id": "x",
            },
        )
    )
    async with _make_client() as client:
        with pytest.raises(PoggleAPIError) as excinfo:
            await client.edit_note(note_id="n", new_content="x")
    assert excinfo.value.status == 409
    assert excinfo.value.error_code == "branch_not_open"


# ---------------------------------------------------------------------------
# link_notes
# ---------------------------------------------------------------------------


@respx.mock
async def test_link_notes_posts_and_returns_link_id() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/link_notes").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "run_id": ENVELOPE["run_id"],
                    "link_id": "link-1",
                    "source_note_id": "a",
                    "target_note_id": "b",
                    "relationship_type": "reference_for",
                    "branch_id": ENVELOPE["branch_id"],
                },
                "meta": {},
            },
        )
    )
    async with _make_client() as client:
        result = await client.link_notes(
            source_note_id="a",
            target_note_id="b",
            relationship_type="reference_for",
            relationship_note="why",
        )

    sent = route.calls.last.request.read().decode()
    assert "reference_for" in sent and "why" in sent
    assert result["link_id"] == "link-1"
    assert result["relationship_type"] == "reference_for"


# ---------------------------------------------------------------------------
# apply_template
# ---------------------------------------------------------------------------


@respx.mock
async def test_apply_template_posts_variables_and_box_id() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/apply_template").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "run_id": ENVELOPE["run_id"],
                    "note_id": "note-new",
                    "title": "Daily 2026-04-19",
                    "branch_id": ENVELOPE["branch_id"],
                    "template_id": "tmpl-1",
                },
                "meta": {},
            },
        )
    )
    async with _make_client() as client:
        result = await client.apply_template(
            template_id="tmpl-1",
            title="Daily 2026-04-19",
            variables={"topic": "tools"},
            box_id="box-7",
        )
    body = route.calls.last.request.read().decode()
    assert "tmpl-1" in body and "box-7" in body and "topic" in body
    assert result["note_id"] == "note-new"
    assert result["template_id"] == "tmpl-1"


@respx.mock
async def test_apply_template_passes_empty_variables_dict_when_none() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/apply_template").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "note_id": "n",
                    "title": "t",
                    "branch_id": ENVELOPE["branch_id"],
                    "template_id": "tmpl-1",
                },
                "meta": {},
            },
        )
    )
    async with _make_client() as client:
        await client.apply_template(
            template_id="tmpl-1",
            title="t",
            box_id="box-1",
        )
    body = route.calls.last.request.read().decode()
    assert '"variables":{}' in body or '"variables": {}' in body


# ---------------------------------------------------------------------------
# web_fetch
# ---------------------------------------------------------------------------


@respx.mock
async def test_web_fetch_returns_text_payload() -> None:
    route = respx.post(f"{BASE_URL}/api/agent/tools/web_fetch").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "run_id": ENVELOPE["run_id"],
                    "url": "https://example.com",
                    "final_url": "https://example.com/",
                    "status": 200,
                    "content_type": "text/html; charset=utf-8",
                    "text": "Hello world",
                    "truncated": False,
                },
                "meta": {},
            },
        )
    )
    async with _make_client() as client:
        result = await client.web_fetch(url="https://example.com")

    body = route.calls.last.request.read().decode()
    assert "https://example.com" in body
    assert result["status"] == 200
    assert result["text"] == "Hello world"
    assert result["truncated"] is False


@respx.mock
async def test_web_fetch_propagates_502_on_fetch_failure() -> None:
    respx.post(f"{BASE_URL}/api/agent/tools/web_fetch").mock(
        return_value=httpx.Response(
            502,
            json={
                "error_code": "fetch_failed",
                "message": "Failed to fetch URL",
                "request_id": "x",
            },
        )
    )
    async with _make_client() as client:
        with pytest.raises(PoggleAPIError) as excinfo:
            await client.web_fetch(url="https://example.com")
    assert excinfo.value.status == 502
    assert excinfo.value.error_code == "fetch_failed"
