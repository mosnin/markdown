"""Typed payloads that cross the Next.js <-> Modal boundary."""

from __future__ import annotations

from pydantic import BaseModel, Field


class OperatorInput(BaseModel):
    """Payload posted by `dispatchOperatorRun` in the Next.js service."""

    run_id: str = Field(min_length=8, max_length=128)
    user_id: str = Field(min_length=1)
    workspace_id: str = Field(min_length=1)
    branch_id: str = Field(min_length=1)
    box_id: str = Field(min_length=1)
    prompt: str = Field(min_length=1, max_length=4000)


class OperatorResult(BaseModel):
    """Final response returned to the Next.js service."""

    run_id: str
    status: str  # "completed" | "failed"
    notes_created: list[str] = Field(default_factory=list)
    tool_calls: int = 0
    error: str | None = None


class SearchResult(BaseModel):
    note_id: str
    title: str
    snippet: str | None = None
    similarity: float | None = None
    keyword_score: float | None = None
    combined_score: float | None = None
    match_type: str | None = None


class DraftNoteResult(BaseModel):
    note_id: str
    title: str
    branch_id: str
