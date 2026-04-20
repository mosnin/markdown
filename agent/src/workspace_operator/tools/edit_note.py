"""`edit_note` tool — edit an existing note on the run's draft branch.

Writes are always branch-scoped: the canonical `notes` row on main is
never mutated by an agent. The Next.js endpoint enforces this — it
always passes the envelope's branch_id to `updateNoteOnBranch`, so the
agent has no way to bypass the review-as-diff contract.
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


class EditNoteInput(BaseModel):
    note_id: str = Field(min_length=1, description="ID of the note to edit")
    new_content: str = Field(
        description=(
            "Full replacement Markdown for the note body. The agent supplies "
            "the entire new body — there is no partial-patch mode in v1."
        ),
    )
    edit_summary: str | None = Field(
        default=None,
        max_length=500,
        description="Optional one-line summary of what changed and why.",
    )


class EditNoteOutput(BaseModel):
    note_id: str
    branch_id: str
    version_id: str
    version_number: int
    markdown_content: str = ""


def build_edit_note_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="edit_note",
        description_override=(
            "Replace the body of an existing note. The change is written to "
            "the user's review branch (NOT main) — they will see it as a diff "
            "and choose to promote or discard. Always read the note first with "
            "`read_note` so your edit reflects the current content. The "
            "response echoes back the full `markdown_content` you wrote so you "
            "can verify it landed as intended without an extra `read_note` round-trip."
        ),
    )
    async def edit_note(
        _ctx: RunContextWrapper[Any], args: EditNoteInput
    ) -> EditNoteOutput:
        result = await client.edit_note(
            note_id=args.note_id,
            new_content=args.new_content,
            edit_summary=args.edit_summary,
        )
        return EditNoteOutput(
            note_id=result["note_id"],
            branch_id=result["branch_id"],
            version_id=result["version_id"],
            version_number=int(result["version_number"]),
            markdown_content=str(result.get("markdown_content", "")),
        )

    return edit_note
