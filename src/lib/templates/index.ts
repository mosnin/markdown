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
  markdownContent: string;
}

// ─── Box templates ────────────────────────────────────────────────────────────

export const BOX_TEMPLATES: BoxTemplate[] = [
  {
    id: "research",
    label: "Research box",
    description:
      "Structured space for literature, findings, and research notes. Includes a guide note that orients retrieval.",
    folders: [
      { key: "literature", name: "Literature" },
      { key: "findings", name: "Findings" },
      { key: "notes", name: "Notes" },
    ],
    notes: [
      {
        key: "guide",
        title: "Research guide",
        kind: "guide",
        isGuide: true,
        markdownContent: `# Research guide

This guide note orients retrieval for this research box.
Update it as your research focus sharpens.

## Scope

What is this research about? Define the domain clearly.

## Key questions

- What are you trying to learn?
- What decisions depend on this research?

## Sources and methods

How are you gathering information? What sources are trustworthy?

## Status

Current phase of research and what is still open.
`,
      },
      {
        key: "overview",
        title: "Research overview",
        kind: "note",
        markdownContent: `# Research overview

High-level summary of findings and current understanding.

## Summary

Write a synthesis here as your research progresses.

## Open questions

List unresolved questions and threads to follow.

## References

- Key sources, papers, or documents worth noting
`,
      },
    ],
  },

  {
    id: "project",
    label: "Project box",
    description:
      "Tracks a single project with context, decisions, and resources. Guide note anchors the project summary.",
    folders: [
      { key: "decisions", name: "Decisions" },
      { key: "resources", name: "Resources" },
      { key: "notes", name: "Notes" },
    ],
    notes: [
      {
        key: "guide",
        title: "Project guide",
        kind: "guide",
        isGuide: true,
        markdownContent: `# Project guide

The authoritative orientation note for this project box.
Keep it current as the project evolves.

## What this project is

Describe the project in one or two sentences.

## Goals

- What must be true when this project is complete?

## Scope and constraints

What is in scope? What is explicitly out of scope?

## Key contacts and dependencies

Who owns this? What does it depend on?

## Current status

Where things stand right now.
`,
      },
      {
        key: "decisions",
        title: "Decision log",
        kind: "note",
        folderKey: "decisions",
        markdownContent: `# Decision log

Record decisions made during this project with rationale.

| Date | Decision | Rationale | Made by |
|------|----------|-----------|---------|
|      |          |           |         |
`,
      },
    ],
  },

  {
    id: "knowledge",
    label: "Knowledge box",
    description:
      "A reference and knowledge base with topics, guides, and reference material.",
    folders: [
      { key: "topics", name: "Topics" },
      { key: "reference", name: "Reference" },
      { key: "guides", name: "Guides" },
    ],
    notes: [
      {
        key: "guide",
        title: "Knowledge base guide",
        kind: "guide",
        isGuide: true,
        markdownContent: `# Knowledge base guide

This guide note describes the scope and structure of this knowledge base.

## Domain

What area of knowledge does this box cover?

## How to use this box

- Browse **Topics** for conceptual notes
- Browse **Reference** for lookup material
- Browse **Guides** for how-to content

## Principles

What standards or conventions apply to notes in this box?
`,
      },
    ],
  },
];

// ─── Note starter templates ───────────────────────────────────────────────────

export const NOTE_TEMPLATES: NoteStarterTemplate[] = [
  {
    id: "guide_note",
    label: "Guide note",
    description:
      "Orients retrieval for a box. Describes scope, key questions, and current status.",
    kind: "guide",
    markdownContent: `# Guide note

This guide note orients retrieval for the box it belongs to.
AI agents and context bundles read this first.

## Scope

What is this box about? Define the domain.

## Key questions

What questions should notes in this box help answer?

## Structure

How is content organized in this box?

## Status

Current state and what is actively being updated.
`,
  },
  {
    id: "overview_note",
    label: "Overview note",
    description:
      "A high-level synthesis of a topic. Good as a context bundle anchor.",
    kind: "note",
    markdownContent: `# Overview

High-level synthesis of the topic this note covers.

## Summary

Write a concise summary here.

## Key points

- Point one
- Point two
- Point three

## Details

Expand on the key points with supporting detail.

## Related

Link to related notes and resources.
`,
  },
  {
    id: "bundle_prep",
    label: "Context bundle prep",
    description:
      "Structured note for assembling a bounded retrieval package.",
    kind: "bundle",
    markdownContent: `# Context bundle

A curated retrieval package for a specific context or task.

## Purpose

What is this bundle for? Who will consume it?

## Scope

What context should be included? What should be excluded?

## Key notes

List the notes and their roles in this bundle:

- Note A — provides background on X
- Note B — defines Y
- Note C — explains the relationship

## Assembly notes

Any special considerations for assembling this bundle.
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
