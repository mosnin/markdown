"""Mid-run steering — user messages injected at tool boundaries.

The user can send "wait, focus on X instead" while a run is live. This
module exposes a poller that fetches unread messages from
/api/agent/operator/steer/poll, returns them, and a helper to format them
as an injection prompt for the next LLM turn.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from workspace_operator.client import PoggleClient

log = logging.getLogger(__name__)


@dataclass
class SteerMessage:
    """A single user-authored steering message to inject into the run."""

    id: str
    content: str
    created_at: str
    sender_user_id: str


def _parse_steer_message(raw: Any) -> SteerMessage | None:
    """Best-effort parse of a steer message dict. Returns None if malformed."""
    if not isinstance(raw, dict):
        return None
    msg_id = raw.get("id")
    content = raw.get("content")
    created_at = raw.get("created_at")
    sender = raw.get("sender_user_id")
    if not isinstance(msg_id, str) or not isinstance(content, str):
        return None
    if not isinstance(created_at, str) or not isinstance(sender, str):
        return None
    return SteerMessage(
        id=msg_id,
        content=content,
        created_at=created_at,
        sender_user_id=sender,
    )


async def fetch_steer_messages(client: "PoggleClient") -> list[SteerMessage]:
    """Fetch + consume unread steering messages for this run.

    Returns the list (possibly empty). Calling this also marks them read on
    the Next.js side, so subsequent calls only see new messages.
    """
    try:
        payload = await client.poll_steer_messages()
    except Exception:  # noqa: BLE001 — caller decides whether to retry
        log.warning("poll_steer_messages failed", exc_info=True)
        return []

    raw_messages = (
        payload.get("messages") if isinstance(payload, dict) else None
    ) or []
    parsed: list[SteerMessage] = []
    for raw in raw_messages:
        msg = _parse_steer_message(raw)
        if msg is not None:
            parsed.append(msg)
    return parsed


def format_steer_injection(messages: list[SteerMessage]) -> str:
    """Render steering messages as a system-style interjection for the LLM."""
    if not messages:
        return ""
    lines = [
        "## User update",
        "The user sent the following messages while you were working. "
        "Incorporate them into your next actions:",
        "",
    ]
    for idx, msg in enumerate(messages, start=1):
        lines.append(f'{idx}. "{msg.content}"')
    return "\n".join(lines)


async def run_steer_poller(
    client: "PoggleClient",
    *,
    cancel_event: asyncio.Event,
    on_messages: Callable[[list[SteerMessage]], Awaitable[None]],
    interval_s: float = 3.0,
) -> None:
    """Poll for steering messages until ``cancel_event`` is set.

    On each tick, fetches unread messages; if any, invokes ``on_messages``.
    All exceptions are swallowed + logged so a transient blip can't tear
    down the run loop.
    """
    while not cancel_event.is_set():
        try:
            await asyncio.wait_for(cancel_event.wait(), timeout=interval_s)
            # cancel_event was set during the wait -> exit cleanly.
            return
        except asyncio.TimeoutError:
            pass
        except asyncio.CancelledError:
            return

        try:
            messages = await fetch_steer_messages(client)
            if messages:
                await on_messages(messages)
        except asyncio.CancelledError:
            return
        except Exception:  # noqa: BLE001 — keep polling on any failure
            log.warning("steer poller tick failed", exc_info=True)
