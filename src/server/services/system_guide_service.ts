/**
 * System guide service.
 *
 * Provides a structured, code-defined description of Context Store's rules,
 * entities, and invariants. This is the authoritative reference for:
 *
 * - The MCP server when explaining the product model to AI clients
 * - The API layer when building error messages or documentation
 * - Retrieval prompts that need to describe the system to an LLM
 *
 * This module intentionally has no Supabase dependency — it is pure data.
 * Update this file whenever the data model or product rules change.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntityDefinition {
  name: string;
  description: string;
  keyInvariants: string[];
}

export interface RelationshipDefinition {
  type: string;
  description: string;
}

export interface SystemGuide {
  productName: string;
  productDescription: string;
  storageHierarchy: string[];
  entities: EntityDefinition[];
  noteKinds: Array<{ kind: string; description: string }>;
  relationshipTypes: RelationshipDefinition[];
  retrievalRules: string[];
  writeRules: string[];
  statusValues: string[];
}

// ─── Static guide ─────────────────────────────────────────────────────────────

const SYSTEM_GUIDE: SystemGuide = {
  productName: "Context Store",
  productDescription:
    "Context Store is a personal knowledge management system for capturing, organizing, and retrieving structured context. " +
    "It is designed for a single owner (V1) and exposes its content to AI agents via an MCP server.",

  storageHierarchy: [
    "Workspace — top-level; one per owner in V1",
    "Box — focused collection within a workspace (project, topic, domain)",
    "Folder — optional organizational grouping within a box (no semantic meaning)",
    "Note — primary content unit (Markdown, title, tags, summary, read_hint)",
    "NoteVersion — immutable snapshot of a Note at a point in time",
    "NoteLink — explicit directed relationship between two Notes in the same Box",
  ],

  entities: [
    {
      name: "Workspace",
      description: "Top-level organizational unit. One workspace per user in V1.",
      keyInvariants: [
        "Exactly one workspace per authenticated user.",
        "Auto-created on first authenticated access.",
        "slug is unique per owner.",
      ],
    },
    {
      name: "Box",
      description:
        "A focused collection within a workspace. Analogous to a project, topic, or domain. " +
        "The primary permission scope unit for connections.",
      keyInvariants: [
        "slug is unique per workspace (excluding trashed boxes).",
        "guide_note_id is the ONLY canonical pointer to a box's guide note. " +
          "Do not infer guide assignment from notes.kind.",
        "retrieval_priority (0–10) controls surfacing order in AI context retrieval.",
      ],
    },
    {
      name: "Folder",
      description:
        "Optional grouping within a box. Purely structural — no semantic meaning. " +
        "Supports arbitrary nesting via parent_folder_id.",
      keyInvariants: [
        "path_cache (e.g. 'research/papers') is a derived convenience field maintained by the service layer.",
        "accepts_generated_notes controls whether AI connections may create notes here.",
      ],
    },
    {
      name: "Note",
      description: "The primary content unit. Markdown document with rich metadata.",
      keyInvariants: [
        "Create and update operations go through atomic Postgres RPC functions. " +
          "Both the note content and its version snapshot are written in a single transaction.",
        "current_version_id always points to the latest NoteVersion after creation.",
        "kind ('note' | 'guide' | 'bundle') describes the note's template type, NOT its guide assignment.",
        "Guide assignment is exclusively controlled by boxes.guide_note_id.",
        "retrieval_priority (0–10) controls surfacing order in AI context retrieval.",
        "Tags are free-form labels used in full-text search (weight A).",
        "summary is a short plain-text description used in search (weight B) and display.",
        "read_hint is a short instruction for AI readers on how to interpret this note.",
      ],
    },
    {
      name: "NoteVersion",
      description: "Immutable full-content snapshot of a note's state.",
      keyInvariants: [
        "Never mutated after creation. No UPDATE or DELETE policies.",
        "version_number is monotonically increasing per note, starting at 1.",
        "parent_version_id forms a linked list of version history.",
      ],
    },
    {
      name: "NoteLink",
      description: "Explicit directed relationship between two notes.",
      keyInvariants: [
        "Directional: source_note_id → target_note_id.",
        "Both notes must be in the same box (enforced by service layer, not DB).",
        "Self-links are rejected by a database CHECK constraint.",
        "No duplicate links: UNIQUE(source_note_id, target_note_id, relationship_type).",
        "No UPDATE policy: changing relationship_type requires delete + re-insert.",
      ],
    },
  ],

  noteKinds: [
    {
      kind: "note",
      description:
        "Standard note. The default kind for human-authored context.",
    },
    {
      kind: "guide",
      description:
        "A guide-style document intended to orient readers to a topic or box. " +
          "A note with kind='guide' may or may not be assigned as a box's guide note — " +
          "that assignment is controlled exclusively by boxes.guide_note_id.",
    },
    {
      kind: "bundle",
      description:
        "A curated context bundle assembled for export or AI consumption. " +
          "Typically aggregates references to other notes.",
    },
  ],

  relationshipTypes: [
    { type: "related",       description: "General association between two notes." },
    { type: "depends_on",   description: "Source note's understanding depends on the target note." },
    { type: "parent_of",    description: "Source is a conceptual parent of the target note." },
    { type: "child_of",     description: "Source is a conceptual child of the target note." },
    { type: "reference_for", description: "Source note is cited as a reference for the target." },
    { type: "extends",      description: "Source note builds upon or continues the target note." },
    { type: "example_of",   description: "Source note is a concrete example of the target note." },
    { type: "sibling_of",   description: "Source and target are peer-level notes." },
    { type: "supersedes",   description: "Source note replaces or supersedes the target note." },
    { type: "derived_from", description: "Source note was derived or extracted from the target." },
  ],

  retrievalRules: [
    "Always filter by box_id — retrieval is box-scoped in V1.",
    "Exclude trashed and archived notes from default results.",
    "Prefer notes with higher retrieval_priority when ranking context.",
    "The box's guide note (boxes.guide_note_id) should be included first in context bundles when present.",
    "Full-text search uses weighted fields: title+tags (A) > summary+read_hint (B) > body (C).",
    "NoteLinks are directional; query both outgoing and incoming links for a complete view.",
  ],

  writeRules: [
    "All note mutations go through the create_note_with_initial_version or update_note_and_create_version RPC functions.",
    "Application-layer retry for note writes is not acceptable — the RPC functions are atomic.",
    "Soft-delete notes by setting status='trashed', not by hard DELETE.",
    "Never clear boxes.guide_note_id implicitly — require an explicit clearGuideNote call.",
    "NoteLink creation must validate same-box constraint before inserting.",
  ],

  statusValues: [
    "active — visible and accessible in default views",
    "archived — hidden from default views, accessible via explicit filter",
    "trashed — excluded from all queries; not hard-deleted immediately",
  ],
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function getSystemGuide(): SystemGuide {
  return SYSTEM_GUIDE;
}

/**
 * Returns a compact plain-text summary of the system guide suitable for
 * inclusion in an LLM system prompt or MCP tool description.
 */
export function getSystemGuideText(): string {
  const g = SYSTEM_GUIDE;
  const lines: string[] = [
    `# ${g.productName}`,
    ``,
    g.productDescription,
    ``,
    `## Storage hierarchy`,
    ...g.storageHierarchy.map((s) => `- ${s}`),
    ``,
    `## Note kinds`,
    ...g.noteKinds.map((k) => `- **${k.kind}**: ${k.description}`),
    ``,
    `## Link relationship types`,
    ...g.relationshipTypes.map((r) => `- **${r.type}**: ${r.description}`),
    ``,
    `## Retrieval rules`,
    ...g.retrievalRules.map((r) => `- ${r}`),
    ``,
    `## Write rules`,
    ...g.writeRules.map((r) => `- ${r}`),
  ];
  return lines.join("\n");
}
