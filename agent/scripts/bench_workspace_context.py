#!/usr/bin/env python3
"""bench_workspace_context.py — measure the latency cost of fetching live
workspace context for the prompt prefix.

Background
----------
`_build_workspace_context_block` (in
`workspace_operator/operator.py`) currently uses envelope-only fields
(workspace_id + box_id) so the cached prefix is byte-deterministic and
costs zero per-run latency. `docs/modal_agent.md` flags this gap:

>  `fetch_workspace_context` endpoint is wired on both sides but
>  currently unused — Phase 4 context block uses envelope fields only
>  (fast + deterministic). Enable once we've measured cache benefit
>  vs. added per-run latency.

This bench measures the per-run cost of switching to the live-fetch
mode: time `client.fetch_workspace_context()` + the additional
`_build_workspace_context_block(...)` work that the larger payload
implies.

Modes
-----
- **mocked (default)** — uses respx (already a dev dep) to intercept
  the HTTP POST and return a canned, deterministic workspace_context
  envelope. Latency reflects: HTTP-client overhead + JSON
  serialization + the context-block sort/render. This is the *floor*
  the live mode must beat to make the round-trip worthwhile.
- **--live** — opt-in. Reads `POGGLE_BASE_URL`,
  `WORKSPACE_OPERATOR_SHARED_SECRET`, and the envelope ids from env
  and dispatches against the real Poggle Next.js endpoint.

Usage
-----
    .venv/bin/python agent/scripts/bench_workspace_context.py
    .venv/bin/python agent/scripts/bench_workspace_context.py --runs 50
    POGGLE_BASE_URL=... WORKSPACE_OPERATOR_SHARED_SECRET=... \\
      .venv/bin/python agent/scripts/bench_workspace_context.py --live --runs 5

Outputs mean / p50 / p95 / min / max wall-clock latency in milliseconds
over N runs (default 20). stdlib only for stats/timing — no new
pyproject deps. Mocking uses respx, already in
`[project.optional-dependencies.dev]`.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import statistics
import sys
import time
from pathlib import Path

# Make `workspace_operator` importable when running from a checkout
# without `pip install -e .` having been run.
_AGENT_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(_AGENT_SRC))

import respx  # dev dep — see pyproject [project.optional-dependencies.dev]
from httpx import Response

from workspace_operator.client import PoggleClient  # noqa: E402
from workspace_operator.operator import _build_workspace_context_block  # noqa: E402


# Mock workspace context payload — sized roughly like a real workspace
# (40 boxes). The Next.js endpoint returns the usual `{data, meta}`
# envelope; PoggleClient._post unwraps `data`.
def _make_mock_workspace_context(num_boxes: int = 40) -> dict[str, object]:
    boxes = [
        {
            "id": f"box-{i:04d}-uuid-aaaa-bbbb-cccccccccccc",
            "name": f"Workstream {i:02d}",
            "note_count": (i * 13) % 97,
        }
        for i in range(num_boxes)
    ]
    return {
        "data": {
            "workspace_name": "Bench Workspace",
            "boxes": boxes,
        },
        "meta": {"version": "v1"},
    }


_BASE_URL = "https://poggle.bench.invalid"


async def _run_mocked(runs: int, num_boxes: int) -> list[float]:
    """Time a fetch_workspace_context() + context-block build, mocked."""
    samples: list[float] = []
    payload = _make_mock_workspace_context(num_boxes=num_boxes)

    async with respx.mock(base_url=_BASE_URL, assert_all_called=False) as router:
        router.post("/api/agent/tools/workspace_context").mock(
            return_value=Response(200, json=payload)
        )

        client = PoggleClient(
            base_url=_BASE_URL,
            shared_secret="s" * 40,
            user_id="bench-user",
            workspace_id="bench-workspace",
            branch_id="bench-branch",
            run_id="bench-run-0123456789ab",
            timeout_s=30.0,
        )

        # Warmup — first call pays for first httpx connection setup
        # (even when respx-mocked there is one-time cost).
        await client.fetch_workspace_context()
        _ = _build_workspace_context_block(
            workspace_id="bench-workspace",
            box_id="bench-box",
            boxes=payload["data"]["boxes"],  # type: ignore[index]
            workspace_name="Bench Workspace",
        )

        try:
            for _ in range(runs):
                t0 = time.perf_counter()
                ctx = await client.fetch_workspace_context()
                _block = _build_workspace_context_block(
                    workspace_id="bench-workspace",
                    box_id="bench-box",
                    boxes=ctx.get("boxes"),
                    workspace_name=ctx.get("workspace_name"),
                )
                samples.append((time.perf_counter() - t0) * 1000.0)
        finally:
            await client.aclose()
    return samples


async def _run_live(runs: int) -> list[float]:
    """Time a real round-trip to Poggle's `/api/agent/tools/workspace_context`."""
    base = os.environ.get("POGGLE_BASE_URL")
    secret = os.environ.get("WORKSPACE_OPERATOR_SHARED_SECRET")
    user_id = os.environ.get("BENCH_USER_ID")
    workspace_id = os.environ.get("BENCH_WORKSPACE_ID")
    branch_id = os.environ.get("BENCH_BRANCH_ID")
    box_id = os.environ.get("BENCH_BOX_ID")
    if not all([base, secret, user_id, workspace_id, branch_id, box_id]):
        raise SystemExit(
            "[bench] --live mode requires POGGLE_BASE_URL, "
            "WORKSPACE_OPERATOR_SHARED_SECRET, BENCH_USER_ID, "
            "BENCH_WORKSPACE_ID, BENCH_BRANCH_ID, BENCH_BOX_ID in env."
        )

    client = PoggleClient(
        base_url=base,  # type: ignore[arg-type]
        shared_secret=secret,  # type: ignore[arg-type]
        user_id=user_id,  # type: ignore[arg-type]
        workspace_id=workspace_id,  # type: ignore[arg-type]
        branch_id=branch_id,  # type: ignore[arg-type]
        run_id="bench-live-0123456789ab",
        timeout_s=30.0,
    )

    # Warmup — first request pays for TLS handshake + DNS + Next.js cold path.
    await client.fetch_workspace_context()

    samples: list[float] = []
    try:
        for _ in range(runs):
            t0 = time.perf_counter()
            ctx = await client.fetch_workspace_context()
            _block = _build_workspace_context_block(
                workspace_id=workspace_id,  # type: ignore[arg-type]
                box_id=box_id,  # type: ignore[arg-type]
                boxes=ctx.get("boxes"),
                workspace_name=ctx.get("workspace_name"),
            )
            samples.append((time.perf_counter() - t0) * 1000.0)
    finally:
        await client.aclose()
    return samples


def _percentile(samples: list[float], pct: float) -> float:
    """Linear-interpolated percentile — see bench_guardrail_latency.py."""
    if not samples:
        return 0.0
    ordered = sorted(samples)
    if len(ordered) == 1:
        return ordered[0]
    rank = (pct / 100.0) * (len(ordered) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(ordered) - 1)
    frac = rank - lo
    return ordered[lo] + (ordered[hi] - ordered[lo]) * frac


def _print_summary(label: str, samples: list[float]) -> None:
    if not samples:
        print(f"[bench] {label}: no samples")
        return
    mean = statistics.fmean(samples)
    stdev = statistics.pstdev(samples) if len(samples) > 1 else 0.0
    p50 = _percentile(samples, 50)
    p95 = _percentile(samples, 95)
    lo = min(samples)
    hi = max(samples)
    print(
        f"[bench] {label}: "
        f"mean={mean:.2f}ms stdev={stdev:.2f}ms "
        f"p50={p50:.2f}ms p95={p95:.2f}ms "
        f"min={lo:.2f}ms max={hi:.2f}ms over {len(samples)} runs"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--runs", type=int, default=20, help="number of timed iterations (default: 20)"
    )
    parser.add_argument(
        "--boxes",
        type=int,
        default=40,
        help="number of boxes in the mocked workspace (default: 40)",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help=(
            "hit the real Poggle endpoint instead of a respx mock "
            "(requires POGGLE_BASE_URL + WORKSPACE_OPERATOR_SHARED_SECRET + "
            "BENCH_{USER,WORKSPACE,BRANCH,BOX}_ID in env)"
        ),
    )
    args = parser.parse_args()

    mode = "live" if args.live else "mocked"
    print(
        f"[bench] target=fetch_workspace_context mode={mode} "
        f"runs={args.runs} boxes={args.boxes if not args.live else 'n/a'}"
    )

    if args.live:
        samples = asyncio.run(_run_live(args.runs))
    else:
        samples = asyncio.run(_run_mocked(args.runs, args.boxes))

    _print_summary(f"fetch_workspace_context ({mode})", samples)

    if not args.live:
        print(
            "[bench] note: mocked numbers reflect respx + httpx + sort/render only. "
            "Add real network RTT (typically 30-150ms cross-region) for the "
            "live SLA number. Re-run with --live for the real cost."
        )


if __name__ == "__main__":
    main()
