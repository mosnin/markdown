"""Tests for `PoggleClient.check_cancellation` (Wave 1 F).

Exercises the new `GET /api/agent/operator/check_cancel?run_id=...` round-trip:
the client sends the envelope headers + a `run_id` query param, and parses the
`{ data: { run_id, cancelled } }` envelope back into a bool.
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


async def _make_client() -> PoggleClient:
    return PoggleClient(base_url=BASE_URL, **ENVELOPE)


@respx.mock
async def test_check_cancellation_returns_true_when_endpoint_says_so() -> None:
    respx.get(f"{BASE_URL}/api/agent/operator/check_cancel").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "run_id": ENVELOPE["run_id"],
                    "cancelled": True,
                },
                "meta": {},
            },
        )
    )
    async with await _make_client() as client:
        result = await client.check_cancellation(ENVELOPE["run_id"])
    assert result is True


@respx.mock
async def test_check_cancellation_returns_false_when_endpoint_says_so() -> None:
    respx.get(f"{BASE_URL}/api/agent/operator/check_cancel").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "run_id": ENVELOPE["run_id"],
                    "cancelled": False,
                },
                "meta": {},
            },
        )
    )
    async with await _make_client() as client:
        result = await client.check_cancellation(ENVELOPE["run_id"])
    assert result is False


@respx.mock
async def test_check_cancellation_forwards_envelope_headers_and_query() -> None:
    route = respx.get(f"{BASE_URL}/api/agent/operator/check_cancel").mock(
        return_value=httpx.Response(
            200,
            json={"data": {"run_id": ENVELOPE["run_id"], "cancelled": False}, "meta": {}},
        )
    )
    async with await _make_client() as client:
        await client.check_cancellation(ENVELOPE["run_id"])

    assert route.called
    req = route.calls.last.request
    assert req.method == "GET"
    assert req.headers["x-workspace-operator-secret"] == ENVELOPE["shared_secret"]
    assert req.headers["x-workspace-operator-run-id"] == ENVELOPE["run_id"]
    # run_id is also passed as a query param (the endpoint reads it from there
    # so polling can target a different run than the one the envelope was
    # minted for, e.g. during retries).
    assert ENVELOPE["run_id"] in req.url.query.decode()


@respx.mock
async def test_check_cancellation_5xx_raises_poggle_api_error() -> None:
    respx.get(f"{BASE_URL}/api/agent/operator/check_cancel").mock(
        return_value=httpx.Response(
            503,
            json={"error_code": "internal_error", "message": "DB down"},
        )
    )
    async with await _make_client() as client:
        with pytest.raises(PoggleAPIError) as excinfo:
            await client.check_cancellation(ENVELOPE["run_id"])
    assert excinfo.value.status == 503


@respx.mock
async def test_check_cancellation_unexpected_envelope_raises() -> None:
    respx.get(f"{BASE_URL}/api/agent/operator/check_cancel").mock(
        return_value=httpx.Response(200, json={"oops": True})
    )
    async with await _make_client() as client:
        with pytest.raises(PoggleAPIError):
            await client.check_cancellation(ENVELOPE["run_id"])
