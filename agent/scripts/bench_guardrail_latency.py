#!/usr/bin/env python3
"""bench_guardrail_latency.py — measure the latency cost of the
`must_cite_per_claim` output guardrail.

Background
----------
`must_cite_per_claim` (see `workspace_operator/guardrails/must_cite_per_claim.py`)
is a model-based output guardrail: it dispatches an extra `Runner.run`
call against a small checker agent (`gpt-4.1-mini`) on top of the main
operator run. `docs/modal_agent.md` flags it as a "next step" gap:

>  `must_cite_per_claim` guardrail uses an extra LLM call per run
>  when enabled — measure latency impact before exposing to all tiers.

This script measures the wall-clock cost of evaluating the guardrail
once. It does **not** measure end-to-end Operator runs — the goal is
isolated, fair-comparison numbers for the guardrail itself.

Modes
-----
- **mocked (default)** — stubs `Runner.run` so the checker never hits
  OpenAI. Latency reflects the guardrail's pure-Python overhead
  (JSON parse, agent construction, async plumbing). Use this number
  as the *floor* — actual prod latency = this + LLM round-trip.
- **--live** — opt-in. Reads `OPENAI_API_KEY` from env and dispatches
  the real checker. Use only when you need a real SLA number; this
  spends real OpenAI credits.

Usage
-----
    .venv/bin/python agent/scripts/bench_guardrail_latency.py
    .venv/bin/python agent/scripts/bench_guardrail_latency.py --runs 50
    .venv/bin/python agent/scripts/bench_guardrail_latency.py --live --runs 5

Outputs mean / p50 / p95 / min / max wall-clock latency in milliseconds
over N runs (default 20). Uses only stdlib `statistics` and
`time.perf_counter` — no new pyproject deps.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

# Make `workspace_operator` importable when running from a checkout
# without `pip install -e .` having been run.
_AGENT_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(_AGENT_SRC))

from workspace_operator.guardrails.must_cite_per_claim import (  # noqa: E402
    build_must_cite_per_claim_guardrail,
)


# A representative agent output that contains both cited and (deliberately)
# uncited-looking claims. Long enough to mirror real prod payloads.
SAMPLE_OUTPUT = (
    "I drafted a synthesis note for the Q3 competitive landscape.\n\n"
    "Per [[note-abc-123]], the team shipped the new collaboration features "
    "on March 14, 2026. According to [[note-def-456]], adoption of the new "
    "branch model jumped 38% week-over-week after the launch.\n\n"
    "Three risks remain open: integration churn with the Linear sync "
    "([[note-ghi-789]]), authentication edge cases on enterprise tenants "
    "([[note-jkl-012]]), and ambiguous acceptance criteria for the new "
    "agent panel ([[note-mno-345]]).\n\n"
    "Recommended next step: a follow-up note tagging owners and target dates."
)


async def _invoke_guardrail_once(guardrail: object, output: str) -> None:
    """Invoke the guardrail's underlying coroutine once.

    Mirrors the call site inside the OpenAI Agents SDK Runner: the SDK
    awaits `guardrail.guardrail_function(ctx, agent, output)` and then
    inspects `tripwire_triggered`. We don't care about the verdict for
    benchmarking — only the latency.
    """
    inner = (
        getattr(guardrail, "guardrail_function", None)
        or getattr(guardrail, "_func", None)
        or guardrail
    )
    await inner(None, None, output)


async def _run_mocked(runs: int) -> list[float]:
    """Time the guardrail with `Runner.run` stubbed to return canned JSON.

    The mock returns a `final_output` that the guardrail will parse as a
    fully-cited verdict, so the tripwire never fires and the timing is
    representative of the *fast path*.
    """
    samples: list[float] = []
    canned_verdict = SimpleNamespace(
        final_output=json.dumps({"all_cited": True, "uncited_claims": []})
    )
    with patch(
        "workspace_operator.guardrails.must_cite_per_claim.Runner.run",
        new_callable=AsyncMock,
    ) as mock_run:
        mock_run.return_value = canned_verdict
        guardrail = build_must_cite_per_claim_guardrail()

        # One warmup call — first invocation pays the cost of building
        # the checker Agent and importing lazy SDK modules.
        await _invoke_guardrail_once(guardrail, SAMPLE_OUTPUT)

        for _ in range(runs):
            t0 = time.perf_counter()
            await _invoke_guardrail_once(guardrail, SAMPLE_OUTPUT)
            samples.append((time.perf_counter() - t0) * 1000.0)
    return samples


async def _run_live(runs: int) -> list[float]:
    """Time the guardrail against the real OpenAI API.

    Requires `OPENAI_API_KEY` in env. Sets it on the SDK's expected
    var so the bench can be run without pre-exporting if it's already
    in the shell.
    """
    if not os.environ.get("OPENAI_API_KEY"):
        raise SystemExit(
            "[bench] --live mode requires OPENAI_API_KEY in env."
        )
    guardrail = build_must_cite_per_claim_guardrail()

    # Warmup — first call pays for SDK lazy imports + first OpenAI TLS handshake.
    await _invoke_guardrail_once(guardrail, SAMPLE_OUTPUT)

    samples: list[float] = []
    for _ in range(runs):
        t0 = time.perf_counter()
        await _invoke_guardrail_once(guardrail, SAMPLE_OUTPUT)
        samples.append((time.perf_counter() - t0) * 1000.0)
    return samples


def _percentile(samples: list[float], pct: float) -> float:
    """Linear-interpolated percentile. stdlib statistics.quantiles only
    gives quartiles + n-tiles; we want exact p50/p95 for any N."""
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
        "--live",
        action="store_true",
        help=(
            "hit the real OpenAI API instead of the mocked checker "
            "(requires OPENAI_API_KEY; spends real credits)"
        ),
    )
    args = parser.parse_args()

    mode = "live" if args.live else "mocked"
    print(f"[bench] guardrail=must_cite_per_claim mode={mode} runs={args.runs}")
    print(f"[bench] sample output length: {len(SAMPLE_OUTPUT)} chars")

    if args.live:
        samples = asyncio.run(_run_live(args.runs))
    else:
        samples = asyncio.run(_run_mocked(args.runs))

    _print_summary(f"must_cite_per_claim ({mode})", samples)

    if not args.live:
        print(
            "[bench] note: mocked numbers reflect pure-Python overhead only. "
            "Add ~300-1500ms per run for real gpt-4.1-mini round-trips. "
            "Re-run with --live for an end-to-end SLA number."
        )


if __name__ == "__main__":
    main()
