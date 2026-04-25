/**
 * Built-in note templates.
 *
 * These are hardcoded constants — not database rows — so they are always
 * available to every workspace without any migration or seed data.
 *
 * IDs use the `builtin-` prefix to distinguish them from user-created
 * templates and to prevent accidental conflicts with UUIDs.
 */

export interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  markdownContent: string;
}

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    id: "builtin-meeting",
    name: "Meeting Notes",
    description: "Structured meeting record",
    markdownContent: "# {{title}}\n\n**Date:** {{date}}\n**Attendees:**\n\n---\n\n## Agenda\n\n-\n\n## Discussion\n\n## Decisions\n\n> [!priority]\n> Key decisions made in this meeting\n\n## Action Items\n\n- [ ]\n\n## Next Meeting\n\n",
  },
  {
    id: "builtin-decision",
    name: "Decision Log",
    description: "Record a decision with context and rationale",
    markdownContent: "# {{title}}\n\n**Date:** {{date}}\n**Status:** Decided\n\n---\n\n## Context\n\n> [!info]\n> Background information for this decision\n\n## Options Considered\n\n### Option A\n\n### Option B\n\n## Decision\n\n> [!priority]\n> **We decided to:**\n\n## Rationale\n\n## Consequences\n\n",
  },
  {
    id: "builtin-research",
    name: "Research Brief",
    description: "Structured research document",
    markdownContent: "# {{title}}\n\n**Date:** {{date}}\n\n---\n\n## Goal\n\n## Key Questions\n\n1.\n2.\n3.\n\n## Findings\n\n> [!tip]\n> Use this section for synthesized insights, not raw notes\n\n## Sources\n\n## Next Steps\n\n",
  },
  {
    id: "builtin-daily",
    name: "Daily Journal",
    description: "Daily reflection and planning",
    markdownContent: "# {{date}}\n\n## Priorities Today\n\n- [ ]\n- [ ]\n- [ ]\n\n## Notes\n\n## Wins\n\n> [!tip]\n> What went well today?\n\n## Blockers\n\n> [!warning]\n> What's in the way?\n\n## Tomorrow\n\n",
  },
  {
    id: "builtin-agent",
    name: "Agent Prompt",
    description: "Structured note for AI agent instructions",
    markdownContent: "# {{title}}\n\n---\n\n## Context\n\n> [!info]\n> Provide background the agent needs to understand the task\n\n## Goal\n\nWhat should the agent accomplish?\n\n## Output Format\n\nWhat should the result look like?\n\n## Trust Boundary\n\n> [!warning]\n> What should the agent NOT do?\n\n## Skills to Use\n\n",
  },
];
