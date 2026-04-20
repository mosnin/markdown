"""Tool definitions the Workspace Operator exposes to the LLM.

Each tool is a small async function decorated with `@function_tool` from
the OpenAI Agents SDK. Tools close over a `PoggleClient` captured via a
RunContext wrapper so we don't smuggle HTTP state through globals.
"""

from workspace_operator.tools.apply_template import build_apply_template_tool
from workspace_operator.tools.draft import build_draft_note_tool
from workspace_operator.tools.edit_note import build_edit_note_tool
from workspace_operator.tools.link_notes import build_link_notes_tool
from workspace_operator.tools.read_note import build_read_note_tool
from workspace_operator.tools.search import build_hybrid_search_tool
from workspace_operator.tools.web_fetch import build_web_fetch_tool
from workspace_operator.tools.web_search import build_web_search_tool

__all__ = [
    "build_apply_template_tool",
    "build_draft_note_tool",
    "build_edit_note_tool",
    "build_hybrid_search_tool",
    "build_link_notes_tool",
    "build_read_note_tool",
    "build_web_fetch_tool",
    "build_web_search_tool",
]
