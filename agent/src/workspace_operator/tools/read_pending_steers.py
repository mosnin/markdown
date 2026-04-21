"""`read_pending_steers` tool — expose mid-run user messages to the agent.

The SDK lacks a clean way to inject messages into a live conversation, so
we surface unread steer messages as a tool the LLM can call between other
tool invocations. The existing `run_steer_poller` keeps emitting
``steer_message_received`` events for observability; this tool gives the
agent a direct read path so it can proactively check for redirection
before expensive operations (writes, long sandbox runs, web fetches).
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel

from workspace_operator.client import PoggleClient
from workspace_operator.steering import fetch_steer_messages


class ReadSteersInput(BaseModel):
    """Empty input — the tool takes no arguments."""

    pass


class ReadSteersOutput(BaseModel):
    messages: list[str]
    count: int


def build_read_pending_steers_tool(client: PoggleClient) -> Any:
    """Return a `function_tool` the agent can call to drain pending steers.

    Calling this consumes the messages server-side (the poll endpoint
    marks them read), so the agent won't see the same guidance twice.
    """

    @function_tool(
        name_override="read_pending_steers",
        description_override=(
            "Check for any pending user messages sent while you were working. "
            "Call this between tool calls periodically — especially before "
            "expensive operations — so the user can redirect you mid-run. "
            "Returns a list of message strings. Empty list means no new "
            "guidance."
        ),
    )
    async def read_pending_steers(
        _ctx: RunContextWrapper[Any], _args: ReadSteersInput
    ) -> ReadSteersOutput:
        messages = await fetch_steer_messages(client)
        return ReadSteersOutput(
            messages=[m.content for m in messages],
            count=len(messages),
        )

    return read_pending_steers
