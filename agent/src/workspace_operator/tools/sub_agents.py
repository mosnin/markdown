"""Sub-agents exposed to the orchestrator as tools.

The OpenAI Agents SDK supports turning an `Agent` into a callable tool
via `Agent.as_tool(tool_name=..., tool_description=...)`. This gives us
LLM-scoped delegation: the orchestrator can hand a narrow task to a
sub-agent with its own focused instructions + narrower tool surface,
and receive the final text back as the tool result.

Typical orchestrator wiring:

    sub_tools = build_sub_agent_tools(
        client, box_id=box_id, workspace_context_block=ctx,
    )
    Agent(name="Workspace Operator", instructions=..., tools=[*sub_tools, ...])
"""

from __future__ import annotations

from typing import Any

from agents import Agent

from workspace_operator.client import PoggleClient
from workspace_operator.tools.curator import build_list_notes_in_box_tool
from workspace_operator.tools.draft import build_draft_note_tool
from workspace_operator.tools.edit_note import build_edit_note_tool
from workspace_operator.tools.execute_code import build_execute_code_tool
from workspace_operator.tools.link_notes import build_link_notes_tool
from workspace_operator.tools.read_note import build_read_note_tool
from workspace_operator.tools.search import build_hybrid_search_tool
from workspace_operator.tools.web_fetch import build_web_fetch_tool
from workspace_operator.tools.web_search import build_web_search_tool

_R = (
    "You are the Research sub-agent. Gather context from the workspace and "
    "the public web and return a compact, cited summary. Do NOT draft, edit, "
    "or link notes. Cite workspace notes with `[[note_id]]` and web sources "
    "with their URL. Prefer `hybrid_search` + `read_note` before falling back "
    "to the web."
)
_D = (
    "You are the Drafting sub-agent. Produce or refine a note on the run's "
    "review branch. Read for context, but your deliverable is a draft or "
    "edit. Every factual claim must be cited as `[[note_id]]`. Keep drafts "
    "tight — your caller will ask for iterations if more is needed."
)
_C = (
    "You are the Code sub-agent. Verify behavior, parse data, or compute "
    "values via the `execute_code` sandbox, and report results back. You may "
    "read notes for context and draft a summary note when asked. The sandbox "
    "is for bounded, deterministic checks only — no secrets."
)


def _compose(role: str, ctx: str) -> str:
    return role + "\n\n" + ctx if ctx else role


def build_research_agent(
    client: PoggleClient, workspace_context_block: str = ""
) -> Agent:
    """Read/search-heavy sub-agent. No write tools."""
    return Agent(
        name="Research Sub-Agent",
        instructions=_compose(_R, workspace_context_block),
        tools=[
            build_hybrid_search_tool(client),
            build_read_note_tool(client),
            build_list_notes_in_box_tool(client),
            build_web_search_tool(client),
            build_web_fetch_tool(client),
        ],
    )


def build_drafting_agent(
    client: PoggleClient, *, box_id: str, workspace_context_block: str = ""
) -> Agent:
    """Drafting-focused sub-agent. Gets draft/edit/link + read tools."""
    return Agent(
        name="Drafting Sub-Agent",
        instructions=_compose(_D, workspace_context_block),
        tools=[
            build_hybrid_search_tool(client),
            build_read_note_tool(client),
            build_draft_note_tool(client, box_id=box_id),
            build_edit_note_tool(client),
            build_link_notes_tool(client),
        ],
    )


def build_code_agent(
    client: PoggleClient, *, box_id: str, workspace_context_block: str = ""
) -> Agent:
    """Code-reviewer sub-agent with sandboxed execution."""
    return Agent(
        name="Code Sub-Agent",
        instructions=_compose(_C, workspace_context_block),
        tools=[
            build_hybrid_search_tool(client),
            build_read_note_tool(client),
            build_execute_code_tool(client),
            build_draft_note_tool(client, box_id=box_id),
        ],
    )


_DESCRIPTIONS = {
    "research": "Delegate a research task. Input: natural-language question. Output: cited summary.",
    "drafting": "Delegate a drafting/editing task. Input: description of the note. Output: final draft text.",
    "code": "Delegate a code/sandbox task. Input: what to compute or verify. Output: result + any notes produced.",
}


def build_sub_agent_tools(
    client: PoggleClient,
    *,
    box_id: str,
    workspace_context_block: str = "",
    include: tuple[str, ...] = ("research", "drafting", "code"),
) -> list[Any]:
    """Return a list of tools (from `Agent.as_tool(...)`) to register."""
    builders = {
        "research": lambda: build_research_agent(client, workspace_context_block),
        "drafting": lambda: build_drafting_agent(
            client, box_id=box_id, workspace_context_block=workspace_context_block
        ),
        "code": lambda: build_code_agent(
            client, box_id=box_id, workspace_context_block=workspace_context_block
        ),
    }
    tools: list[Any] = []
    for key in include:
        if key in builders:
            tools.append(
                builders[key]().as_tool(
                    tool_name=f"delegate_to_{key}",
                    tool_description=_DESCRIPTIONS[key],
                )
            )
    return tools
