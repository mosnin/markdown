import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for `buildPogGraphContext`.
 *
 * The service fans out to two underlying calls:
 *   - `listEntitiesByWorkspace` (vocabulary section)
 *   - `graphRagQuery`           (GraphRAG section)
 *
 * Both are mocked so we can drive each branch in isolation:
 *   1. Empty workspace + no GraphRAG hits -> empty string.
 *   2. Vocabulary only (no graph query matches) -> vocabulary section only.
 *   3. Vocabulary + graph hits -> both sections concatenated.
 */

vi.mock("@/server/services/graph_rag_service");
vi.mock("@/server/repositories/entity_repository");

import { buildPogGraphContext } from "@/server/services/pog_context_service";
import * as graphRagService from "@/server/services/graph_rag_service";
import * as entityRepo from "@/server/repositories/entity_repository";
import type { Entity } from "@/server/domain/types/entity";
import type { GraphRagResult } from "@/server/services/graph_rag_service";

const WORKSPACE_ID = "ws-1";

function makeEntity(o: Partial<Entity> & { id: string; name: string }): Entity {
  return {
    id: o.id,
    workspace_id: WORKSPACE_ID,
    name: o.name,
    entity_type: o.entity_type ?? "person",
    description: o.description ?? null,
    mention_count: o.mention_count ?? 1,
    first_seen_at: "2026-01-01T00:00:00Z",
    last_seen_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const EMPTY_GRAPH: GraphRagResult = {
  matchedEntities: [],
  expandedEntityIds: [],
  hits: [],
};

describe("pog_context_service.buildPogGraphContext", () => {
  const fakeSupabase = {} as never;

  beforeEach(() => {
    vi.mocked(graphRagService.graphRagQuery).mockReset();
    vi.mocked(graphRagService.formatGraphRagContext).mockReset();
    vi.mocked(entityRepo.listEntitiesByWorkspace).mockReset();

    // Default format passes through the real-ish behaviour: empty when no hits.
    vi.mocked(graphRagService.formatGraphRagContext).mockImplementation(
      (r) => {
        if (r.hits.length === 0) return "";
        return `## Knowledge Graph Context\nhits=${r.hits.length}`;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty string when the workspace has no entities", async () => {
    vi.mocked(entityRepo.listEntitiesByWorkspace).mockResolvedValue([]);
    vi.mocked(graphRagService.graphRagQuery).mockResolvedValue(EMPTY_GRAPH);

    const ctx = await buildPogGraphContext(
      fakeSupabase,
      WORKSPACE_ID,
      "Hello"
    );

    expect(ctx).toBe("");
  });

  it("returns only the vocabulary section when entities exist but the query has no match", async () => {
    vi.mocked(entityRepo.listEntitiesByWorkspace).mockResolvedValue([
      makeEntity({
        id: "e-alice",
        name: "Alice",
        entity_type: "person",
        description: "staff eng",
      }),
      makeEntity({
        id: "e-q4",
        name: "Q4 Launch",
        entity_type: "project",
        description: null,
      }),
    ]);
    vi.mocked(graphRagService.graphRagQuery).mockResolvedValue(EMPTY_GRAPH);

    const ctx = await buildPogGraphContext(
      fakeSupabase,
      WORKSPACE_ID,
      "random prompt with no entity match"
    );

    expect(ctx).toContain("## Workspace Vocabulary");
    expect(ctx).toContain("- Alice (person) — staff eng");
    // Entity without a description should omit the em-dash clause.
    expect(ctx).toContain("- Q4 Launch (project)");
    expect(ctx).not.toContain("Q4 Launch (project) —");
    expect(ctx).not.toContain("## Knowledge Graph Context");
  });

  it("returns both vocabulary and GraphRAG sections when the query matches entities", async () => {
    const alice = makeEntity({
      id: "e-alice",
      name: "Alice",
      entity_type: "person",
    });
    vi.mocked(entityRepo.listEntitiesByWorkspace).mockResolvedValue([alice]);
    vi.mocked(graphRagService.graphRagQuery).mockResolvedValue({
      matchedEntities: [alice],
      expandedEntityIds: [alice.id],
      hits: [
        {
          noteId: "n-1",
          score: 2.5,
          viaEntityId: alice.id,
          viaEntityName: alice.name,
          rationale: "Mentions Alice",
        },
      ],
    });

    const ctx = await buildPogGraphContext(
      fakeSupabase,
      WORKSPACE_ID,
      "Tell me about Alice"
    );

    expect(ctx).toContain("## Workspace Vocabulary");
    expect(ctx).toContain("- Alice (person)");
    expect(ctx).toContain("## Knowledge Graph Context");
    // Sections are joined by a blank line separator.
    expect(ctx.indexOf("## Workspace Vocabulary")).toBeLessThan(
      ctx.indexOf("## Knowledge Graph Context")
    );
  });

  it("passes maxHops:1 and maxHits:8 options to graphRagQuery", async () => {
    vi.mocked(entityRepo.listEntitiesByWorkspace).mockResolvedValue([]);
    vi.mocked(graphRagService.graphRagQuery).mockResolvedValue(EMPTY_GRAPH);

    await buildPogGraphContext(fakeSupabase, WORKSPACE_ID, "anything");

    expect(graphRagService.graphRagQuery).toHaveBeenCalledWith(
      fakeSupabase,
      WORKSPACE_ID,
      "anything",
      expect.objectContaining({ maxHops: 1, maxHits: 8 })
    );
    expect(entityRepo.listEntitiesByWorkspace).toHaveBeenCalledWith(
      fakeSupabase,
      WORKSPACE_ID,
      expect.objectContaining({ limit: 20 })
    );
  });
});
