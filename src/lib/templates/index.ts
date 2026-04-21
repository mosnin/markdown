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
  {
    id: "reading_log",
    label: "Reading log",
    description:
      "Track books, articles, and papers. Capture highlights, reactions, and takeaways.",
    folders: [
      { key: "books", name: "Books" },
      { key: "articles", name: "Articles" },
      { key: "highlights", name: "Highlights" },
    ],
    notes: [
      {
        key: "guide",
        title: "Reading log guide",
        kind: "guide",
        folderKey: "books",
        isGuide: true,
        readHint: "read_first",
        markdownContent: `# Reading log guide

This box is a personal reading record.
Use it to track what you read, what stood out, and what you want to return to.

## Structure

- **Books/** — one note per book: status, reactions, key takeaways
- **Articles/** — one note per article or paper worth keeping
- **Highlights/** — raw excerpts and passages you want to preserve

## Workflow

1. Add a book or article when you start it (or decide to read it).
2. Add highlights as you read — raw is fine, clean up later.
3. When finished, write a short reaction note in the same entry.

## Update conventions

Keep the reading queue current so you can always see what is next.
Mark items Done in the queue rather than deleting them — the history is useful.
`,
      },
      {
        key: "how_to_use",
        title: "How to use this box",
        kind: "note",
        readHint: "supporting_context",
        markdownContent: `# How to use this box

This reading log has three parts:

**Books** holds one note per book. When you start a book, create a note with the title and author. Add your reactions and key ideas as you read. When you finish, write a short summary at the top.

**Articles** works the same way for shorter pieces — blog posts, papers, essays. If it took more than ten minutes to read and you want to remember it, it goes here.

**Highlights** is for raw excerpts. Paste a passage, note where it came from, and move on. You can revisit and connect highlights later.

The reading queue (in Books/) is your single source of truth for what to read next. Keep Status up to date.
`,
      },
      {
        key: "reading_queue",
        title: "Reading queue",
        kind: "note",
        folderKey: "books",
        readHint: "supporting_context",
        markdownContent: `# Reading queue

| Title | Author | Status | Notes |
|-------|--------|--------|-------|
|       |        | To read |      |

**Status values:** To read · In progress · Done · Abandoned

Add new items at the top. Keep Status current.
`,
      },
    ],
  },
  {
    id: "meeting_notes",
    label: "Meeting notes",
    description:
      "One note per meeting. Track attendees, decisions, and action items in a consistent format.",
    folders: [
      { key: "recurring", name: "Recurring" },
      { key: "one_off", name: "One-off" },
      { key: "action_items", name: "Action items" },
    ],
    notes: [
      {
        key: "guide",
        title: "Meeting notes guide",
        kind: "guide",
        isGuide: true,
        readHint: "read_first",
        markdownContent: `# Meeting notes guide

This box stores meeting notes in a consistent, retrievable format.
One note per meeting. Decisions and action items are always in the same place.

## Structure

- **Recurring/** — notes for standing meetings (weekly syncs, 1:1s, sprint reviews)
- **One-off/** — notes for ad hoc meetings, interviews, conversations
- **Action items/** — consolidated tracker for open actions across all meetings

## Workflow

1. Before each meeting, create a note from the Meeting template.
2. Fill in attendees and agenda before the meeting starts.
3. During the meeting, capture decisions and action items in real time.
4. After the meeting, transfer new action items to the Action items tracker.

## Naming convention

Name notes by date and meeting name: \`2024-01-15 Weekly sync\`.
This keeps them sortable and makes gaps obvious.

## Update conventions

Never edit a past meeting note's decisions section — decisions are durable.
You may add follow-up context as a postscript below the original note.
`,
      },
      {
        key: "meeting_template",
        title: "Meeting template",
        kind: "note",
        readHint: "core_reference",
        markdownContent: `# Meeting template

Copy this note for each new meeting. Rename it with the date and meeting name.

---

## Date

YYYY-MM-DD — HH:MM

## Attendees

- Name (role)
- Name (role)

## Agenda

1. Item one
2. Item two
3. Item three

## Decisions

Record decisions made, not discussion. Be specific.

- **Decision:** What was decided. **Rationale:** Why.

## Action items

| Owner | Action | Due |
|-------|--------|-----|
|       |        |     |

## Next meeting

Date / agenda items to carry forward.
`,
      },
    ],
  },
  {
    id: "personal_crm",
    label: "Personal CRM",
    description:
      "Maintain context on people you work with: relationships, shared history, and follow-ups.",
    folders: [
      { key: "people", name: "People" },
      { key: "companies", name: "Companies" },
      { key: "follow_ups", name: "Follow-ups" },
    ],
    notes: [
      {
        key: "guide",
        title: "Personal CRM guide",
        kind: "guide",
        isGuide: true,
        readHint: "read_first",
        markdownContent: `# Personal CRM guide

This box helps you maintain context on the people you work with.
The goal is not a database — it is enough context to be genuinely prepared for every interaction.

## Structure

- **People/** — one note per person: background, shared history, context
- **Companies/** — one note per organization you engage with regularly
- **Follow-ups/** — a single tracker for things you promised or intended to do

## Workflow

1. After a meaningful conversation, update or create the person's note.
2. Capture: what you talked about, what they are working on, anything personal they mentioned.
3. Add any follow-up commitments to the Follow-up tracker immediately.
4. Review the Follow-up tracker weekly.

## What makes a good person note

- How you met and the nature of the relationship
- What they care about, what they are working toward
- Your last interaction and what was discussed
- Anything you want to remember for next time

Keep notes honest and specific. Vague notes do not help.
`,
      },
      {
        key: "person_template",
        title: "Person template",
        kind: "note",
        folderKey: "people",
        readHint: "core_reference",
        markdownContent: `# Person template

Copy this note for each new person. Rename it with their name.

---

## Name

Full name

## Role

Current title and organization.

## Company

Link to company note if applicable.

## How we met

Where and when. Who introduced us, or what brought us together.

## Context

What do they work on? What do they care about? What are they trying to accomplish?
Update this as you learn more.

## Last interaction

**Date:** YYYY-MM-DD
**What we discussed:**

## Follow-up

Anything you want to do or say next time.

## Notes

Anything else worth remembering.
`,
      },
      {
        key: "follow_up_tracker",
        title: "Follow-up tracker",
        kind: "note",
        folderKey: "follow_ups",
        readHint: "supporting_context",
        markdownContent: `# Follow-up tracker

| Person | Topic | Due date | Done |
|--------|-------|----------|------|
|        |       |          |      |

Review this weekly. Mark items Done rather than deleting them.

**Tips:**
- Add follow-ups immediately after a conversation — do not rely on memory.
- "Due date" can be approximate: "end of month" or "before next 1:1" is fine.
- If a follow-up is no longer relevant, note why in the topic column before marking Done.
`,
      },
    ],
  },
  {
    id: "book_summaries",
    label: "Book summaries",
    description:
      "Permanent notes on books you've read. Capture core ideas, quotes, and your own synthesis.",
    folders: [
      { key: "summaries", name: "Summaries" },
      { key: "quotes", name: "Quotes" },
      { key: "synthesis", name: "Synthesis" },
    ],
    notes: [
      {
        key: "guide",
        title: "Book summaries guide",
        kind: "guide",
        isGuide: true,
        readHint: "read_first",
        markdownContent: `# Book summaries guide

This box holds permanent notes on books you have read.
The goal is a lasting record of what each book taught you — in your own words.

## Approach

Each summary captures not just what the book said, but what you think about it.
Summaries here are written for your future self, not for an audience.
A good summary takes 30–60 minutes to write after finishing a book.

## Structure

- **Summaries/** — one note per book, using the Book summary template
- **Quotes/** — memorable passages, organized by book or theme
- **Synthesis/** — notes that connect ideas across multiple books

## What goes in a summary

- The core thesis in one or two sentences (your words, not the blurb)
- The three to five ideas you will actually remember
- The quotes you want to keep
- What you disagree with or would push back on
- How it connects to things you already know

## Update conventions

You may update a summary after re-reading or after new experience changes your view.
Note the date and reason for any significant revision.
`,
      },
      {
        key: "book_summary_template",
        title: "Book summary template",
        kind: "note",
        folderKey: "summaries",
        readHint: "core_reference",
        markdownContent: `# Book summary template

Copy this note for each book. Rename it with the book title.

---

## Title

Full title

## Author

Author name(s)

## Date read

YYYY-MM

## Core thesis

What is the book's central claim or argument? One or two sentences in your own words.

## Key ideas

1. **First idea** — your summary of it and why it matters.
2. **Second idea** — your summary of it and why it matters.
3. **Third idea** — your summary of it and why it matters.

Add more as needed. Three to five is usually right.

## Best quotes

> Paste notable quotes here with page or chapter reference.

## My take

What do you agree with? What do you push back on?
What surprised you? What will you actually do differently?

## Connections to other books

- Link or mention books that address similar ideas, agree, or conflict.
- Note where this book extends or contradicts something you already believed.
`,
      },
    ],
  },
  {
    id: "research",
    label: "Research",
    description:
      "Gather, organize, and synthesize research on any topic. Link sources, track questions, and build conclusions.",
    folders: [
      { key: "sources", name: "Sources" },
      { key: "questions", name: "Questions" },
      { key: "synthesis", name: "Synthesis" },
      { key: "references", name: "References" },
    ],
    notes: [
      {
        key: "guide",
        title: "Research guide",
        kind: "guide",
        isGuide: true,
        readHint: "read_first",
        markdownContent: `# Research guide

This box supports structured research on a topic from initial question to synthesis.

## Workflow

1. **Start with Questions/** — define what you are trying to find out before you start gathering.
2. **Add Sources/** — one note per source as you gather. Summarize immediately while fresh.
3. **Build Synthesis/** — once you have enough sources, write synthesis notes that draw connections and build toward answers.
4. **References/** — bibliographic records, raw links, or anything you want to cite but have not fully processed.

## What makes good research notes

- Capture your own reaction to a source, not just its contents.
- Note credibility and limitations alongside the claims.
- Write synthesis notes frequently — do not wait until the end.
- Track open questions explicitly. Knowing what you do not know is part of the work.

## Update conventions

Questions and synthesis notes evolve as the research develops.
Source notes are records — update them only to add missing information, not to revise past reactions.
`,
      },
      {
        key: "research_question",
        title: "Research question",
        kind: "note",
        folderKey: "questions",
        readHint: "core_reference",
        markdownContent: `# Research question

Copy this note for each major question you are investigating.

---

## Question

State the question precisely. Vague questions produce vague research.

## Why it matters

What depends on the answer? What decision or understanding does this inform?

## What I already know

What do you believe before researching? What is your current best guess?

## What I need to find out

Break the main question into sub-questions:

- Sub-question one
- Sub-question two
- Sub-question three

## Candidate sources

Where do you expect to find the answer? Experts, papers, datasets, practitioners?

## Current status

What have you found so far? What remains open?
`,
      },
      {
        key: "source_template",
        title: "Source template",
        kind: "note",
        folderKey: "sources",
        readHint: "supporting_context",
        markdownContent: `# Source template

Copy this note for each source. Rename it with the source title.

---

## Title

Full title of the source.

## URL / Citation

Link or bibliographic reference.

## Type

Article · Paper · Book · Interview · Dataset · Other

## Summary

What is this source about? Two to four sentences.

## Key claims

- Claim one — note any supporting evidence cited.
- Claim two — note any supporting evidence cited.
- Claim three — note any supporting evidence cited.

## Credibility

Who produced this? What methodology or evidence base does it rely on?
What are the limitations or potential biases?

## Relevance

Which of your research questions does this address?

## Notes

Anything else — contradictions with other sources, things to follow up, passages to quote.
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
