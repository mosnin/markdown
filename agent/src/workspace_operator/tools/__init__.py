"""Tool definitions the Workspace Operator exposes to the LLM.

Each tool is a small async function decorated with `@function_tool` from
the OpenAI Agents SDK. Tools close over a `PoggleClient` captured via a
RunContext wrapper so we don't smuggle HTTP state through globals.
"""

from workspace_operator.tools.search import build_hybrid_search_tool
from workspace_operator.tools.draft import build_draft_note_tool

__all__ = ["build_hybrid_search_tool", "build_draft_note_tool"]
