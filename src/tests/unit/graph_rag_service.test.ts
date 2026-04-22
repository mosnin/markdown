import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the GraphRAG retrieval service.
 *
 * Stubs the three repositories so no real DB is needed:
 *   - entity_repository.listEntitiesByWorkspace / getEntityById
 *   - entity_mention_repository.listMentionsByEntity
 *   - entity_edge_repository.listEdgesForEntity
 *
 * Invariants exercised:
 *   1. Empty workspace -> empty hits (no match path entered).
 *   2. Query with no entity-name matches -> empty hits.
 *   3. Single entity match -> hits include mentions for that entity.
 *   4. Multiple entity matches sharing a note -> scores accumulate on that note.
 *   5. Direct-match base score (2.0) > indirect-match base score (1.0).
 */

vi.mock("@/server/repositories/entity_repository");
vi.mock("@/server/repositories/entity_mention_repository");
vi.mock("@/server/repositories/entity_edge_repository");

import { graphRagQuery } from "@/server/services/graph_rag_service";
import * as entityRepo from "@/server/repositories/entity_repository";
import * as mentionRepo from "@/server/repositories/entity_mention_repository";
import * as edgeRepo from "@/server/repositories/entity_edge_repository";
import type { Entity } from "@/server/domain/types/entity";
import type { EntityMention } from "@/server/domain/types/entity_mention";
import type { EntityEdge } from "@/server/domain/types/entity_edge";

const WORKSPACE_ID = "ws-1";

function makeEntity(overrides: Partial<Entity> & { id: string; name: string }): Entity {
  return {
    id: overrides.id,
    workspace_id: WORKSPACE_ID,
    name: overrides.name,
    entity_type: overrides.entity_type ?? "concept",
    description: overrides.description ?? null,
    mention_count: overrides.mention_count ?? 1,
    first_seen_at: "2026-01-01T00:00:00Z",
    last_seen_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function makeMention(overrides: {
  id: string;
  entity_id: string;
  note_id: string;
}): EntityMention {
  return {
    id: overrides.id,
    workspace_id: WORKSPACE_ID,
    entity_id: overrides.entity_id,
    note_id: overrides.note_id,
    surface_form: "",
    context: null,
    position_start: null,
    position_end: null,
    branch_id: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function makeEdge(overrides: {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
}): EntityEdge {
  return {
    id: overrides.id,
    workspace_id: WORKSPACE_ID,
    source_entity_id: overrides.source_entity_id,
    target_entity_id: overrides.target_entity_id,
    edge_type: "relates_to",
    confidence: 1.0,
    note_id: null,
    context: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("graph_rag_service", () => {
  const fakeSupabase = {} as never;

  beforeEach(() => {
    vi.mocked(entityRepo.listEntitiesByWorkspace).mockReset();
    vi.mocked(entityRepo.getEntityById).mockReset();
    vi.mocked(mentionRepo.listMentionsByEntity).mockReset();
    vi.mocked(edgeRepo.listEdgesForEntity).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty hits for an empty workspace", async () => {
    vi.mocked(entityRepo.listEntitiesByWorkspace).mockResolvedValue([]);

    const result = await graphRagQuery(fakeSupabase, WORKSPACE_ID, "Alice");

    expect(result.matchedEntities).toEqual([]);
    expect(result.expandedEntityIds).toEqual([]);
    expect(result.hits).toEqual([]);
    expect(edgeRepo.listEdgesForEntity).not.toHaveBeenCalled();
    expect(mentionRepo.listMentionsByEntity).not.toHaveBeenCalled();
  });

  it("returns empty hits when the query matches no known entity", async () => {
    vi.mocked(entityRepo.listEntitiesByWorkspace).mockResolvedValue([
      makeEntity({ id: "e-alice", name: "Alice", mention_count: 10 }),
    ]);

    const result = await graphRagQuery(
      fakeSupabase,
      WORKSPACE_ID,
      "unrelated vocabulary"
    );

    expect(result.matchedEntities).toEqual([]);
    expect(result.hits).toEqual([]);
    expect(edgeRepo.listEdgesForEntity).not.toHaveBeenCalled();
    expect(mentionRepo.listMentionsByEntity).not.toHaveBeenCalled();
  });

  it("returns mentions for a single matched entity", async () => {
    const alice = makeEntity({
      id: "e-alice",
      name: "Alice",
      mention_count: 5,
    });
    vi.mocked(entityRepo.listEntitiesByWorkspace).mockResolvedValue([alice]);
    vi.mocked(edgeRepo.listEdgesForEntity).mockResolvedValue([]);
    vi.mocked(mentionRepo.listMentionsByEntity).mockImplementation(
      async (_s, entityId) => {
        if (entityId === "e-alice") {
          return [
            makeMention({ id: "m-1", entity_id: "e-alice", note_id: "n-1" }),
            makeMention({ id: "m-2", entity_id: "e-alice", note_id: "n-2" }),
          ];
        }
        return [];
      }
    );

    const result = await graphRagQuery(
      fakeSupabase,
      WORKSPACE_ID,
      "what did Alice say?"
    );

    expect(result.matchedEntities).toHaveLength(1);
    expect(result.matchedEntities[0].id).toBe("e-alice");
    expect(result.hits).toHaveLength(2);
    const noteIds = result.hits.map((h) => h.noteId).sort();
    expect(noteIds).toEqual(["n-1", "n-2"]);
    for (const hit of result.hits) {
      expect(hit.viaEntityName).toBe("Alice");
      expect(hit.rationale).toContain("Alice");
    }
  });

  it("accumulates scores on notes shared by multiple matched entities", async () => {
    const alice = makeEntity({
      id: "e-alice",
      name: "Alice",
      mention_count: 3,
    });
    const bob = makeEntity({ id: "e-bob", name: "Bob", mention_count: 3 });
    vi.mocked(entityRepo.listEntitiesByWorkspace).mockResolvedValue([alice, bob]);
    vi.mocked(edgeRepo.listEdgesForEntity).mockResolvedValue([]);
    vi.mocked(mentionRepo.listMentionsByEntity).mockImplementation(
      async (_s, entityId) => {
        if (entityId === "e-alice") {
          return [
            makeMention({ id: "m-1", entity_id: "e-alice", note_id: "shared" }),
            makeMention({ id: "m-2", entity_id: "e-alice", note_id: "alice-only" }),
          ];
        }
        if (entityId === "e-bob") {
          return [
            makeMention({ id: "m-3", entity_id: "e-bob", note_id: "shared" }),
          ];
        }
        return [];
      }
    );

    const result = await graphRagQuery(
      fakeSupabase,
      WORKSPACE_ID,
      "Alice and Bob met"
    );

    expect(result.matchedEntities.map((e) => e.id).sort()).toEqual([
      "e-alice",
      "e-bob",
    ]);

    const shared = result.hits.find((h) => h.noteId === "shared");
    const aliceOnly = result.hits.find((h) => h.noteId === "alice-only");

    expect(shared).toBeDefined();
    expect(aliceOnly).toBeDefined();
    // Shared note gets contributions from two entities -> higher score.
    expect(shared!.score).toBeGreaterThan(aliceOnly!.score);
    // Shared rationale mentions both matched entities.
    expect(shared!.rationale).toMatch(/Alice/);
    expect(shared!.rationale).toMatch(/Bob/);
  });

  it("scores direct matches higher than indirect (edge-expanded) matches", async () => {
    const alice = makeEntity({
      id: "e-alice",
      name: "Alice",
      mention_count: 1,
    });
    // Q4-Launch is NOT in the query text but is reachable via a hop from Alice.
    const project = makeEntity({
      id: "e-project",
      name: "Q4-Launch",
      mention_count: 1,
      entity_type: "project",
    });
    vi.mocked(entityRepo.listEntitiesByWorkspace).mockResolvedValue([
      alice,
      project,
    ]);
    vi.mocked(entityRepo.getEntityById).mockImplementation(async (_s, id) => {
      if (id === "e-project") return project;
      if (id === "e-alice") return alice;
      return null;
    });
    vi.mocked(edgeRepo.listEdgesForEntity).mockImplementation(
      async (_s, entityId) => {
        if (entityId === "e-alice") {
          return [
            makeEdge({
              id: "edge-1",
              source_entity_id: "e-alice",
              target_entity_id: "e-project",
            }),
          ];
        }
        return [];
      }
    );
    vi.mocked(mentionRepo.listMentionsByEntity).mockImplementation(
      async (_s, entityId) => {
        if (entityId === "e-alice") {
          return [
            makeMention({ id: "m-1", entity_id: "e-alice", note_id: "note-direct" }),
          ];
        }
        if (entityId === "e-project") {
          return [
            makeMention({
              id: "m-2",
              entity_id: "e-project",
              note_id: "note-indirect",
            }),
          ];
        }
        return [];
      }
    );

    const result = await graphRagQuery(fakeSupabase, WORKSPACE_ID, "Alice");

    const direct = result.hits.find((h) => h.noteId === "note-direct");
    const indirect = result.hits.find((h) => h.noteId === "note-indirect");

    expect(direct).toBeDefined();
    expect(indirect).toBeDefined();
    expect(direct!.score).toBeGreaterThan(indirect!.score);
    expect(direct!.rationale.startsWith("Mentions ")).toBe(true);
    expect(indirect!.rationale.startsWith("Links to ")).toBe(true);
  });
});
