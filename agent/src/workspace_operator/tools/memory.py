"""Memory tools — persistent, workspace-scoped recall across runs.

Two tools are exposed:

* `read_memories` at the start of a run to load durable facts /
  preferences the user (or a prior run) has established.
* `write_memory` to record something new that should survive beyond
  this run. Write sparingly — anything ephemeral belongs in the run's
  working notes, not in long-term memory.
"""

from __future__ import annotations

from typing import Any, Literal

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


MemoryType = Literal[
    "workspace_facts",
    "user_preferences",
    "recent_work",
    "learned_schemas",
    "project_context",
]


class MemoryEntry(BaseModel):
    id: str
    memory_type: str
    title: str
    content: str
    relevance: float = 0.0
    last_used_at: str | None = None


class ReadMemoriesInput(BaseModel):
    memory_type: MemoryType | None = Field(default=None)
    limit: int = Field(default=10, ge=1, le=50)


class ReadMemoriesOutput(BaseModel):
    memories: list[MemoryEntry] = Field(default_factory=list)


class WriteMemoryInput(BaseModel):
    memory_type: MemoryType
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=8000)
    relevance: float = Field(default=1.0, ge=0, le=10)


class WriteMemoryOutput(BaseModel):
    memory_id: str
    created: bool


def _parse_entry(m: dict) -> MemoryEntry:
    return MemoryEntry(
        id=str(m.get("id") or ""),
        memory_type=str(m.get("memory_type") or ""),
        title=str(m.get("title") or ""),
        content=str(m.get("content") or ""),
        relevance=float(m.get("relevance") or 0.0),
        last_used_at=(
            str(m["last_used_at"]) if m.get("last_used_at") is not None else None
        ),
    )


def build_read_memories_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="read_memories",
        description_override=(
            "Retrieve persistent memories stored for this workspace "
            "across prior runs. Use at the start of a run to refresh on "
            "what's been learned or preferred."
        ),
    )
    async def read_memories(
        _ctx: RunContextWrapper[Any], args: ReadMemoriesInput
    ) -> ReadMemoriesOutput:
        result = await client.read_memories(
            memory_type=args.memory_type, limit=args.limit
        )
        raw = result.get("memories") or []
        return ReadMemoriesOutput(memories=[_parse_entry(m) for m in raw])

    return read_memories


def build_write_memory_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="write_memory",
        description_override=(
            "Persist something you learned or should remember for future "
            "runs. Use sparingly — only for durable facts, preferences, "
            "or patterns that will matter next week. Do NOT use for "
            "ephemeral status."
        ),
    )
    async def write_memory(
        _ctx: RunContextWrapper[Any], args: WriteMemoryInput
    ) -> WriteMemoryOutput:
        result = await client.write_memory(
            memory_type=args.memory_type,
            title=args.title,
            content=args.content,
            relevance=args.relevance,
        )
        return WriteMemoryOutput(
            memory_id=str(result.get("memory_id") or ""),
            created=bool(result.get("created", False)),
        )

    return write_memory
