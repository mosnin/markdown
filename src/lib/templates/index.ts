/**
 * Context Store V1 template definitions.
 *
 * Templates are structured starting points for boxes and notes.
 * They encode product-appropriate patterns, not generic document scaffolding.
 *
 * Template application is deterministic: it calls existing service functions
 * in order (create box → create folders → create notes → assign guide).
 * Templates do not bypass versioning, audit, or ownership checks.
 *
 * To add a template: add an entry to BOX_TEMPLATES or NOTE_TEMPLATES,
 * give it a stable id, and document its intended use.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NoteTemplate {
  /** Relative key — used to cross-reference folder placement */
  key: string;
  title: string;
  kind: "note" | "guide" | "bundle";
  /** Which folder key this note belongs in. Undefined = box root. */
  folderKey?: string;
  /** Whether this note should be assigned as the box's guide note */
  isGuide?: boolean;
  /** read_hint value applied at note creation time */
  readHint?: string;
  markdownContent: string;
}

export interface FolderTemplate {
  key: string;
  name: string;
}

export interface BoxTemplate {
  id: string;
  label: string;
  description: string;
  folders: FolderTemplate[];
  notes: NoteTemplate[];
}

export interface NoteStarterTemplate {
  id: string;
  label: string;
  description: string;
  kind: "note" | "guide" | "bundle";
  /** read_hint value applied at note creation time */
  readHint?: string;
  markdownContent: string;
}

// ─── Box templates ────────────────────────────────────────────────────────────

export const BOX_TEMPLATES: BoxTemplate[] = [
  {
    id: "project_context_template",
    label: "Project context",
    description:
      "Structured space for a project's persistent context: guide note, decisions, references, active work, and glossary.",
    folders: [
      { key: "overview", name: "Overview" },
      { key: "decisions", name: "Decisions" },
      { key: "references", name: "References" },
      { key: "active_work", name: "Active work" },
      { key: "glossary", name: "Glossary" },
    ],
    notes: [
      {
        key: "guide",
        title: "Project guide",
        kind: "guide",
        folderKey: "overview",
        isGuide: true,
        readHint: "read_first",
        markdownContent: `# Project guide

This guide note orients retrieval for this project box.
AI agents and context bundles read this first.

## Scope

What is this project? State the domain and primary goals clearly.

## What to read first

- **Decisions/** — rationale behind major choices
- **References/** — background material and specifications
- **Active work/** — current state of in-progress work
- **Glossary/** — canonical term definitions

## Update conventions

Update this note when the project scope or priorities change.
Keep it accurate — retrieval quality depends on it.

## Status

Current phase and what is actively changing.
`,
      },
      {
        key: "overview_note",
        title: "Project overview",
        kind: "note",
        folderKey: "overview",
        readHint: "core_reference",
        markdownContent: `# Project overview

High-level description of the project and its current state.

## Summary

Brief narrative of what this project is and why it exists.

## Goals

- Primary goal
- Secondary goal

## Constraints

What constraints does this project operate under?

## Stakeholders

Who owns this? Who is affected by it?
`,
      },
      {
        key: "decision_log",
        title: "Decision log",
        kind: "note",
        folderKey: "decisions",
        readHint: "supporting_context",
        markdownContent: `# Decision log

Record decisions made during this project with rationale.
Decisions here are durable — do not delete, only append.

| Date | Decision | Rationale | Made by |
|------|----------|-----------|---------|
|      |          |           |         |
`,
      },
      {
        key: "active_work",
        title: "Active work",
        kind: "note",
        folderKey: "active_work",
        readHint: "supporting_context",
        markdownContent: `# Active work

Current in-progress work and open threads.
This note is ephemeral — update it as work progresses.

## In progress

- What is being worked on right now

## Blocked

- What is blocked and why

## Up next

- What is queued after current work
`,
      },
      {
        key: "glossary",
        title: "Glossary",
        kind: "note",
        folderKey: "glossary",
        readHint: "core_reference",
        markdownContent: `# Glossary

Canonical definitions for terms used in this project.
Use these definitions consistently across all notes.

| Term | Definition |
|------|------------|
|      |            |
`,
      },
    ],
  },
];

// ─── Note starter templates ───────────────────────────────────────────────────

export const NOTE_TEMPLATES: NoteStarterTemplate[] = [
  {
    id: "prompt_template",
    label: "Prompt template",
    description:
      "A structured prompt definition for use with an AI model. Captures purpose, inputs, outputs, and usage notes.",
    kind: "note",
    readHint: "core_reference",
    markdownContent: `# Prompt template

## Purpose

What is this prompt for? Describe the task or transformation it performs.

## Inputs

What context or data does this prompt expect to receive?

- Input A — description
- Input B — description

## Outputs

What should the model produce? Describe format, length, and tone constraints.

## Usage notes

When should this prompt be used? What edge cases should the caller handle?

## Revision history

| Date | Change | Reason |
|------|--------|--------|
|      |        |        |
`,
  },
  {
    id: "agent_template",
    label: "Agent template",
    description:
      "A structured agent definition. Captures role, objective, rules, tools, failure modes, escalation paths, and trust level.",
    kind: "note",
    readHint: "read_first",
    markdownContent: `# Agent template

## Role

What is this agent's function? One sentence.

## Objective

What goal does this agent pursue in each session?

## Rules

Behavioral constraints that apply unconditionally:

1. Rule one
2. Rule two
3. Rule three

## Tools

What tools or capabilities does this agent have access to?

| Tool | Purpose |
|------|---------|
|      |         |

## Failure modes

What should the agent do when it cannot complete a task?

## Escalation

When should the agent escalate to a human? How?

## Trust

What can this agent read? What can it write? What can it never do?
`,
  },
  {
    id: "system_template",
    label: "System template",
    description:
      "A structured system definition. Documents constraints, invariants, retrieval hints, update policy, and trust boundaries.",
    kind: "note",
    readHint: "read_first",
    markdownContent: `# System template

## Constraints

Hard constraints this system operates under:

- Constraint A
- Constraint B

## Invariants

Properties that must always be true:

- Invariant A
- Invariant B

## Retrieval hints

How should AI agents read and use this note?

- When to read this note
- What to extract from it
- What to ignore

## Update policy

When should this note be updated? Who may update it?

## Trust

What actors may read or write this system's state?

## Change log

| Date | Change | Author |
|------|--------|--------|
|      |        |        |
`,
  },
  {
    id: "guide_note",
    label: "Guide note",
    description:
      "Orients retrieval for a box. AI agents and context bundles read this first. Describes scope, structure, and update conventions.",
    kind: "guide",
    readHint: "read_first",
    markdownContent: `# Guide note

This guide note orients retrieval for the box it belongs to.
AI agents and context bundles read this first.

## Scope

What is this box about? Define the domain clearly.

## Structure

How is content organized in this box?

## What to read first

Which notes are most important for orienting retrieval?

## Update conventions

When should this note be updated? Who is responsible?

## Status

Current state and what is actively being updated.
`,
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

export function getBoxTemplate(id: string): BoxTemplate | undefined {
  return BOX_TEMPLATES.find((t) => t.id === id);
}

export function getNoteTemplate(id: string): NoteStarterTemplate | undefined {
  return NOTE_TEMPLATES.find((t) => t.id === id);
}
