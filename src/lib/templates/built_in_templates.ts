/**
 * Built-in note templates shown in the template list UI.
 *
 * These are hardcoded constants — read-only from the user's perspective.
 * They appear before user-created templates with a "Built-in" badge.
 *
 * Templates support the same `{{var}}` syntax as user-created templates.
 * Variables resolved at insertion time: {{date}}, {{title}}, {{user}}, {{box_name}}.
 */

export interface BuiltInTemplate {
  /** Stable ID prefixed with "builtin-" */
  id: string;
  name: string;
  description: string;
  markdownContent: string;
}

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    id: "builtin-meeting-notes",
    name: "Meeting Notes",
    description: "Attendees, agenda, decisions, and action items.",
    markdownContent: `# {{title}}

**Date:** {{date}}

## Attendees

-

## Agenda

1.

## Decisions

> [!info]
> Record decisions made, not discussion. Be specific.

-

## Action items

| Owner | Action | Due |
|-------|--------|-----|
|       |        |     |

## Next steps

`,
  },
  {
    id: "builtin-decision-log",
    name: "Decision Log",
    description: "Record a decision with context, options, and rationale.",
    markdownContent: `# {{title}}

**Date:** {{date}}

## Context

What situation prompted this decision?

## Options considered

1. **Option A** — description and trade-offs.
2. **Option B** — description and trade-offs.

## Decision

> [!priority]
> State the decision clearly in one or two sentences.

## Rationale

Why was this option chosen over the alternatives?

## Consequences

What does this decision constrain or enable going forward?

## Open questions

-
`,
  },
  {
    id: "builtin-research-brief",
    name: "Research Brief",
    description: "Structured starting point for a research investigation.",
    markdownContent: `# {{title}}

**Date:** {{date}}

## Question

What are you trying to find out?

## Why it matters

What depends on the answer?

## What I already know

Current best understanding before researching.

## Key sources

> [!tip]
> Add one note per source in your Sources folder, then link here.

-

## Findings

Summary of what the research revealed.

## Open questions

-

## Conclusion

What do you now believe, and with what confidence?
`,
  },
  {
    id: "builtin-daily-journal",
    name: "Daily Journal",
    description: "Daily log with intentions, notes, and reflections.",
    markdownContent: `# {{date}}

## Intentions for today

-

## Notes

> [!info]
> Capture anything worth remembering — decisions, blockers, observations.

## Reflection

What went well? What would you do differently?

## Tomorrow

-
`,
  },
  {
    id: "builtin-agent-prompt",
    name: "Agent Prompt",
    description: "Define a reusable AI agent with role, rules, and tools.",
    markdownContent: `# {{title}}

## Role

One sentence describing what this agent does.

## Objective

What goal does this agent pursue in each session?

## Rules

> [!warning]
> Constraints that apply unconditionally — the agent must not override these.

1.
2.

## Tools

| Tool | Purpose |
|------|---------|
|      |         |

## Failure modes

What should the agent do when it cannot complete a task?

## Trust boundaries

What can this agent read? Write? Never do?
`,
  },
];
