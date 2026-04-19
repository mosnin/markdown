"""`apply_template` tool — instantiate a note template into a new note.

The endpoint substitutes `{{variable}}` placeholders in the template's
markdown using the provided variables (plus built-ins like `{{date}}`)
and creates the resulting note on the run's draft branch.
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel, Field

from workspace_operator.client import PoggleClient


class TemplateVariable(BaseModel):
    """A single `{{name}} → value` substitution.

    The OpenAI Agents SDK enforces strict JSON schemas, which disallow
    free-form `dict[str, str]` (because they require additionalProperties).
    We instead accept a list of explicit name/value pairs and reassemble
    the dict server-side.
    """

    name: str = Field(min_length=1, description="Placeholder name without the `{{}}`")
    value: str = Field(description="Value to substitute for this placeholder")


class ApplyTemplateInput(BaseModel):
    template_id: str = Field(min_length=1, description="ID of the note template")
    title: str = Field(min_length=1, max_length=500)
    variables: list[TemplateVariable] = Field(
        default_factory=list,
        description=(
            "List of `{{name}}` substitutions. Built-ins like `{{date}}` are "
            "auto-supplied — only include variables the template explicitly "
            "references and you want to override."
        ),
    )


class ApplyTemplateOutput(BaseModel):
    note_id: str
    title: str
    branch_id: str
    template_id: str


def build_apply_template_tool(client: PoggleClient, *, box_id: str) -> Any:
    """Return an `apply_template` function_tool bound to the run's box.

    The agent cannot pick a different box than the one the user-action
    envelope opened the run for — same blast-radius rule as `draft_note`.
    """

    @function_tool(
        name_override="apply_template",
        description_override=(
            "Create a new note from a saved template. Provide the template's "
            "id, a title for the new note, and any variable substitutions the "
            "template expects. The new note lands on the user's review branch."
        ),
    )
    async def apply_template(
        _ctx: RunContextWrapper[Any], args: ApplyTemplateInput
    ) -> ApplyTemplateOutput:
        variables_dict = {v.name: v.value for v in args.variables}
        result = await client.apply_template(
            template_id=args.template_id,
            title=args.title,
            variables=variables_dict,
            box_id=box_id,
        )
        return ApplyTemplateOutput(
            note_id=result["note_id"],
            title=result["title"],
            branch_id=result["branch_id"],
            template_id=result["template_id"],
        )

    return apply_template
