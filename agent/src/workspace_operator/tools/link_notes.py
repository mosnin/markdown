"""`link_notes` tool — create a typed relationship between two notes.

The link is created on the run's branch (object_link.branch_id is set
to the envelope branch). On promote, branch-scoped links advance to
main alongside their notes; on discard, they're hard-deleted.
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


# Mirror src/server/domain/constants/note_constants.ts RELATIONSHIP_TYPE
ALLOWED_RELATIONSHIPS = {
    "related",
    "depends_on",
    "parent_of",
    "child_of",
    "reference_for",
    "extends",
    "example_of",
    "sibling_of",
    "supersedes",
    "derived_from",
}


class LinkNotesInput(BaseModel):
    source_note_id: str = Field(min_length=1)
    target_note_id: str = Field(min_length=1)
    relationship_type: str = Field(
        description=(
            "One of: related, depends_on, parent_of, child_of, reference_for, "
            "extends, example_of, sibling_of, supersedes, derived_from."
        )
    )
    relationship_note: str | None = Field(default=None, max_length=500)


class LinkNotesOutput(BaseModel):
    link_id: str
    source_note_id: str
    target_note_id: str
    relationship_type: str
    branch_id: str | None = None


def build_link_notes_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="link_notes",
        description_override=(
            "Create a typed relationship between two notes (e.g. "
            "`reference_for`, `depends_on`, `supersedes`). The link lives on "
            "the user's review branch and is promoted with the rest of the "
            "diff. Self-links and cross-workspace links are rejected by the "
            "server."
        ),
    )
    async def link_notes(
        _ctx: RunContextWrapper[Any], args: LinkNotesInput
    ) -> LinkNotesOutput:
        if args.relationship_type not in ALLOWED_RELATIONSHIPS:
            raise ValueError(
                f"relationship_type must be one of {sorted(ALLOWED_RELATIONSHIPS)}; "
                f"got {args.relationship_type!r}"
            )
        result = await client.link_notes(
            source_note_id=args.source_note_id,
            target_note_id=args.target_note_id,
            relationship_type=args.relationship_type,
            relationship_note=args.relationship_note,
        )
        return LinkNotesOutput(
            link_id=result["link_id"],
            source_note_id=result["source_note_id"],
            target_note_id=result["target_note_id"],
            relationship_type=result["relationship_type"],
            branch_id=result.get("branch_id"),
        )

    return link_notes
