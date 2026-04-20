"""Curator tools — organize and tidy notes alongside the write-path tools.

These tools close the "write but never trim" gap: the agent has `draft_note`
and `edit_note` for authoring, but prior to this module it had no way to
list, archive, rename, or relocate notes. Without those affordances the
agent could only ever grow the workspace, not curate it.

All four tools enforce the same workspace-scoped ownership checks at the
Next.js boundary; the Python side just shapes JSON in and out.
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


# ─── list_notes_in_box ──────────────────────────────────────────────────────


class ListNotesInBoxInput(BaseModel):
    box_id: str = Field(min_length=1, description="The box to list notes from.")
    include_archived: bool = Field(
        default=False,
        description="If true, also return archived notes.",
    )
    limit: int = Field(
        default=50,
        ge=1,
        le=200,
        description="Max notes to return (1-200).",
    )


class ListedNote(BaseModel):
    note_id: str
    title: str
    summary: str | None = None
    tags: list[str] = Field(default_factory=list)
    status: str
    folder_id: str | None = None


class ListNotesInBoxOutput(BaseModel):
    notes: list[ListedNote]


def build_list_notes_in_box_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="list_notes_in_box",
        description_override=(
            "List the notes in a box so you can orient before drafting, "
            "editing, or archiving. Returns note_id + title + status so you "
            "can decide which notes are duplicates, stale, or candidates for "
            "a follow-up edit. Prefer this over `hybrid_search` when you "
            "want a complete inventory of a small box; search is better for "
            "keyword- or semantics-driven lookups across many boxes."
        ),
    )
    async def list_notes_in_box(
        _ctx: RunContextWrapper[Any], args: ListNotesInBoxInput
    ) -> ListNotesInBoxOutput:
        payload = await client.list_notes_in_box(
            box_id=args.box_id,
            include_archived=args.include_archived,
            limit=args.limit,
        )
        notes = [ListedNote.model_validate(n) for n in payload.get("notes", [])]
        return ListNotesInBoxOutput(notes=notes)

    return list_notes_in_box


# ─── archive_note ───────────────────────────────────────────────────────────


class ArchiveNoteInput(BaseModel):
    note_id: str = Field(min_length=1, description="Note to archive.")


class ArchiveNoteOutput(BaseModel):
    note_id: str
    status: str


def build_archive_note_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="archive_note",
        description_override=(
            "Archive a note. Reversible — the user can restore it later. The "
            "system refuses to archive the current guide note for any box, "
            "and refuses notes that are already archived or trashed. Prefer "
            "archiving over asking the user to clean up stale notes later."
        ),
    )
    async def archive_note(
        _ctx: RunContextWrapper[Any], args: ArchiveNoteInput
    ) -> ArchiveNoteOutput:
        payload = await client.archive_note(note_id=args.note_id)
        return ArchiveNoteOutput(
            note_id=str(payload["note_id"]),
            status=str(payload["status"]),
        )

    return archive_note


# ─── rename_note ────────────────────────────────────────────────────────────


class RenameNoteInput(BaseModel):
    note_id: str = Field(min_length=1)
    new_title: str = Field(
        min_length=1,
        max_length=500,
        description="Replacement title (will be trimmed of whitespace).",
    )


class RenameNoteOutput(BaseModel):
    note_id: str
    title: str
    branch_id: str
    version_id: str
    version_number: int


def build_rename_note_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="rename_note",
        description_override=(
            "Change a note's title. The rename lands on the user's review "
            "branch as a new version with the updated title (existing body "
            "is preserved). Use this when you discover a note's title is "
            "wrong, ambiguous, or inconsistent with the rest of the box."
        ),
    )
    async def rename_note(
        _ctx: RunContextWrapper[Any], args: RenameNoteInput
    ) -> RenameNoteOutput:
        payload = await client.rename_note(
            note_id=args.note_id, new_title=args.new_title
        )
        return RenameNoteOutput(
            note_id=str(payload["note_id"]),
            title=str(payload["title"]),
            branch_id=str(payload["branch_id"]),
            version_id=str(payload["version_id"]),
            version_number=int(payload["version_number"]),
        )

    return rename_note


# ─── move_note ──────────────────────────────────────────────────────────────


class MoveNoteInput(BaseModel):
    note_id: str = Field(min_length=1)
    folder_id: str | None = Field(
        default=None,
        description=(
            "Target folder id (must live in the same box as the note), or "
            "null to move the note to the box root."
        ),
    )


class MoveNoteOutput(BaseModel):
    note_id: str
    folder_id: str | None = None


def build_move_note_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="move_note",
        description_override=(
            "Move a note to a different folder within the SAME box. Cross-box "
            "moves are not supported from the agent — ask the user. Pass "
            "`folder_id=null` to move the note to the box root."
        ),
    )
    async def move_note(
        _ctx: RunContextWrapper[Any], args: MoveNoteInput
    ) -> MoveNoteOutput:
        payload = await client.move_note(
            note_id=args.note_id, folder_id=args.folder_id
        )
        return MoveNoteOutput(
            note_id=str(payload["note_id"]),
            folder_id=payload.get("folder_id"),
        )

    return move_note
