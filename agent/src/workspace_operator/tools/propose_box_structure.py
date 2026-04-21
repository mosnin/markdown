"""`propose_box_structure` tool — suggest a reorganization of the workspace.

Read-only: the tool never actually moves notes or renames boxes. It
returns a structured proposal that the UI surfaces to the user for
review. If the user accepts, a separate follow-up flow applies the
changes under their own session — not the agent's envelope.
"""

from __future__ import annotations

from typing import Any, Literal

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


class ProposeBoxStructureInput(BaseModel):
    workspace_scope: Literal["all", "box"] = Field(
        default="all",
        description=(
            "`all` analyses every box in the workspace. `box` limits the "
            "proposal to a single box — `box_id` must be set in that case."
        ),
    )
    box_id: str | None = Field(
        default=None,
        description=(
            "Required when `workspace_scope='box'`. Ignored when scope "
            "is `all`."
        ),
    )


class ProposeBoxStructureOutput(BaseModel):
    current_structure: list[dict] = Field(default_factory=list)
    proposed_reorganization: list[dict] = Field(default_factory=list)
    summary: str = ""


def build_propose_box_structure_tool(client: PoggleClient) -> Any:
    @function_tool(
        name_override="propose_box_structure",
        description_override=(
            "Analyze the workspace's box/note distribution and propose a "
            "reorganization for human review. Does not execute the "
            "changes. Use when the user asks for restructuring advice or "
            "when notes are clearly imbalanced across boxes."
        ),
    )
    async def propose_box_structure(
        _ctx: RunContextWrapper[Any], args: ProposeBoxStructureInput
    ) -> ProposeBoxStructureOutput:
        result = await client.propose_box_structure(
            workspace_scope=args.workspace_scope,
            box_id=args.box_id,
        )
        current = result.get("current_structure") or []
        proposed = result.get("proposed_reorganization") or []
        return ProposeBoxStructureOutput(
            current_structure=[dict(item) for item in current],
            proposed_reorganization=[dict(item) for item in proposed],
            summary=str(result.get("summary") or ""),
        )

    return propose_box_structure
