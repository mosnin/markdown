"""`draft_note` tool — create a new note on the run's draft branch."""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


class DraftNoteInput(BaseModel):
    title: str = Field(min_length=1, max_length=500, description="Note title")
    markdown_content: str = Field(
        description=(
            "The note body in Markdown. Include inline citations as "
            "`[[note_id]]` for any claim sourced from a workspace note — the "
            "cite guardrail rejects outputs without them."
        ),
    )
    summary: str | None = Field(default=None, max_length=500)
    tags: list[str] = Field(default_factory=list)


class DraftNoteOutput(BaseModel):
    note_id: str
    title: str
    branch_id: str
    markdown_content: str = ""


def build_draft_note_tool(client: PoggleClient, *, box_id: str) -> Any:
    """Return a `function_tool` that drafts a note into the caller's box + branch.

    `box_id` is fixed per run by the server-action envelope — the agent
    cannot pick or change its target box. This keeps the blast radius of a
    confused run tightly scoped.
    """

    @function_tool(
        name_override="draft_note",
        description_override=(
            "Create a new Markdown note on the user's review branch. The note "
            "is NOT yet on main — it's a proposal the user will review as a "
            "diff. Every factual claim must be cited to a note_id using the "
            "`[[note_id]]` syntax; claims without citations will cause the run "
            "to fail the output guardrail. The response echoes back the full "
            "`markdown_content` that was written so you can verify it rendered "
            "as intended and iterate with `edit_note` if needed — you do NOT "
            "need to call `read_note` after drafting."
        ),
    )
    async def draft_note(
        _ctx: RunContextWrapper[Any], args: DraftNoteInput
    ) -> DraftNoteOutput:
        result = await client.draft_note(
            box_id=box_id,
            title=args.title,
            markdown_content=args.markdown_content,
            summary=args.summary,
            tags=args.tags,
        )
        return DraftNoteOutput(
            note_id=result.note_id,
            title=result.title,
            branch_id=result.branch_id,
            markdown_content=result.markdown_content,
        )

    return draft_note
