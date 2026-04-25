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
    markdownContent: `# {{title}}

**Date:** {{date}}
**Attendees:**

---

## Agenda

-

## Discussion

## Decisions

> [!priority]
> Key decisions made in this meeting

## Action Items

- [ ]

## Next Meeting

`,
  },
  {
    id: "builtin-decision",
    name: "Decision Log",
    description: "Record a decision with context and rationale",
    markdownContent: `# {{title}}

**Date:** {{date}}
**Status:** Decided

---

## Context

> [!info]
> Background information for this decision

## Options Considered

### Option A

### Option B

## Decision

> [!priority]
> **We decided to:**

## Rationale

## Consequences

`,
  },
  {
    id: "builtin-research",
    name: "Research Brief",
    description: "Structured research document",
    markdownContent: `# {{title}}

**Date:** {{date}}

---

## Goal

## Key Questions

1.
2.
3.

## Findings

> [!tip]
> Use this section for synthesized insights, not raw notes

## Sources

## Next Steps

`,
  },
  {
    id: "builtin-daily",
    name: "Daily Journal",
    description: "Daily reflection and planning",
    markdownContent: `# {{date}}

## Priorities Today

- [ ]
- [ ]
- [ ]

## Notes

## Wins

> [!tip]
> What went well today?

## Blockers

> [!warning]
> What's in the way?

## Tomorrow

`,
  },
  {
    id: "builtin-agent",
    name: "Agent Prompt",
    description: "Structured note for AI agent instructions",
    markdownContent: `# {{title}}

---

## Context

> [!info]
> Provide background the agent needs to understand the task

## Goal

What should the agent accomplish?

## Output Format

What should the result look like?

## Trust Boundary

> [!warning]
> What should the agent NOT do?

## Skills to Use

`,
  },
];
