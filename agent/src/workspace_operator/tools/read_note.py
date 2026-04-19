"""`read_note` tool — fetch a single note's content from the workspace.

Read-only. Available in plan, execute, and full modes. The endpoint
returns the branch-overlay view of the note when the run's envelope
includes a branch_id, so reads inside an open branch see in-progress
edits the agent has made earlier in the same run.
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


class ReadNoteInput(BaseModel):
    note_id: str = Field(min_length=1, description="ID of the note to read")


class ReadNoteOutput(BaseModel):
    note_id: str
    title: str
    content: str
    branch_id: str | None = None
    version: str | None = None


def build_read_note_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="read_note",
        description_override=(
            "Read the full Markdown content of a note in the workspace. "
            "Use this after `hybrid_search` to inspect a candidate note "
            "before citing or editing it. Returns title, content, and "
            "the version id (so subsequent edits can detect drift)."
        ),
    )
    async def read_note(
        _ctx: RunContextWrapper[Any], args: ReadNoteInput
    ) -> ReadNoteOutput:
        result = await client.read_note(note_id=args.note_id)
        return ReadNoteOutput(
            note_id=result["note_id"],
            title=result["title"],
            content=result["content"],
            branch_id=result.get("branch_id"),
            version=result.get("version"),
        )

    return read_note
