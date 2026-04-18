import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for note_template_service.
 *
 * Covers:
 *   1. createTemplate — inserts a row and returns it
 *   2. createTemplateFromNote — copies note content into a template
 *   3. listTemplates — returns templates ordered by sort_order
 *   4. applyTemplate — variable interpolation ({{date}}, {{user}}, {{box_name}})
 *   5. deleteTemplate — removes the template row
 */

import {
  createTemplate,
  createTemplateFromNote,
  listTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  applyTemplate,
} from "@/server/services/note_template_service";

// ─── Fake Supabase builder ───────────────────────────────────────────────────

interface Call {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  filters: Array<{ col: string; val: unknown }>;
  payload?: Record<string, unknown>;
}

function makeSupabase(opts: {
  insertedRow?: Record<string, unknown>;
  selectRows?: Array<Record<string, unknown>>;
  singleRow?: Record<string, unknown> | null;
  updatedRow?: Record<string, unknown>;
  deleteError?: { message: string } | null;
  /** Per-table overrides for single() — keyed by table name */
  tableSingleOverrides?: Record<string, Record<string, unknown> | null>;
}) {
  const calls: Call[] = [];

  function builder(table: string) {
    let op: Call["op"] = "select";
    const filters: Call["filters"] = [];
    let payload: Record<string, unknown> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {};
    b.select = () => {
      // Only set op to "select" if no prior mutating op was set.
      // This supports chaining like .insert({}).select().single().
      if (op === "select") op = "select";
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      filters.push({ col, val });
      return b;
    };
    b.order = () => b;
    b.limit = () => b;
    b.insert = (p: Record<string, unknown>) => {
      op = "insert";
      payload = p;
      return b;
    };
    b.update = (p: Record<string, unknown>) => {
      op = "update";
      payload = p;
      return b;
    };
    b.delete = () => {
      op = "delete";
      return b;
    };
    b.single = async () => {
      calls.push({ table, op, filters: [...filters], payload });
      if (op === "insert") {
        return { data: opts.insertedRow ?? payload, error: null };
      }
      if (op === "update") {
        return { data: opts.updatedRow ?? payload, error: null };
      }
      // Check table-specific overrides for single
      if (opts.tableSingleOverrides && table in opts.tableSingleOverrides) {
        const row = opts.tableSingleOverrides[table];
        return {
          data: row,
          error: row === null ? { message: "Not found" } : null,
        };
      }
      return { data: opts.singleRow ?? null, error: null };
    };
    b.maybeSingle = async () => {
      calls.push({ table, op, filters: [...filters], payload });
      if (opts.tableSingleOverrides && table in opts.tableSingleOverrides) {
        return { data: opts.tableSingleOverrides[table], error: null };
      }
      return { data: opts.singleRow ?? null, error: null };
    };
    b.then = async (resolve: (v: unknown) => void) => {
      calls.push({ table, op, filters: [...filters], payload });
      if (op === "delete") {
        resolve({ error: opts.deleteError ?? null });
        return;
      }
      resolve({ data: opts.selectRows ?? [], error: null });
    };
    return b;
  }

  return {
    from: builder,
    calls,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("note_template_service", () => {
  describe("createTemplate", () => {
    it("inserts a template row and returns it", async () => {
      const inserted = {
        id: "tpl-1",
        box_id: "box-1",
        workspace_id: "ws-1",
        name: "Meeting notes",
        description: "Standard meeting notes structure",
        markdown_content: "# Meeting\n\n## Attendees\n\n## Notes\n",
        tags: ["meeting"],
        created_by: "user-1",
        is_default: false,
        sort_order: 0,
        created_at: "2026-04-18T00:00:00Z",
        updated_at: "2026-04-18T00:00:00Z",
      };
      const sb = makeSupabase({ insertedRow: inserted });
      const result = await createTemplate(sb as any, {
        boxId: "box-1",
        workspaceId: "ws-1",
        name: "Meeting notes",
        description: "Standard meeting notes structure",
        markdownContent: "# Meeting\n\n## Attendees\n\n## Notes\n",
        tags: ["meeting"],
        createdBy: "user-1",
      });

      expect(result.id).toBe("tpl-1");
      expect(result.name).toBe("Meeting notes");
      expect(result.markdown_content).toContain("## Attendees");
      expect(sb.calls[0].table).toBe("note_templates");
      expect(sb.calls[0].op).toBe("insert");
    });
  });

  describe("createTemplateFromNote", () => {
    it("copies a note's content into a new template", async () => {
      const noteRow = {
        title: "My design doc",
        box_id: "box-1",
        workspace_id: "ws-1",
        tags: ["design"],
        created_by: "user-1",
      };
      const versionRow = {
        markdown_content: "# Design doc\n\nContent here.",
      };
      const inserted = {
        id: "tpl-from-note",
        box_id: "box-1",
        workspace_id: "ws-1",
        name: "Template from My design doc",
        description: null,
        markdown_content: "# Design doc\n\nContent here.",
        tags: ["design"],
        created_by: "user-1",
        is_default: false,
        sort_order: 0,
        created_at: "2026-04-18T00:00:00Z",
        updated_at: "2026-04-18T00:00:00Z",
      };

      const sb = makeSupabase({
        insertedRow: inserted,
        tableSingleOverrides: {
          notes: noteRow,
          note_versions: versionRow,
        },
      });

      const result = await createTemplateFromNote(sb as any, "note-1");
      expect(result.id).toBe("tpl-from-note");
      expect(result.markdown_content).toBe("# Design doc\n\nContent here.");
      expect(result.name).toBe("Template from My design doc");
    });
  });

  describe("listTemplates", () => {
    it("returns templates for a box ordered by sort_order", async () => {
      const rows = [
        { id: "tpl-1", name: "First", sort_order: 0 },
        { id: "tpl-2", name: "Second", sort_order: 1 },
      ];
      const sb = makeSupabase({ selectRows: rows });

      const result = await listTemplates(sb as any, "box-1");
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("tpl-1");
      expect(result[1].id).toBe("tpl-2");
      expect(sb.calls[0].table).toBe("note_templates");
      expect(sb.calls[0].filters).toContainEqual({ col: "box_id", val: "box-1" });
    });
  });

  describe("applyTemplate", () => {
    it("replaces {{date}} with current date", () => {
      const content = "Created on {{date}}.";
      const result = applyTemplate(content);
      // Should be YYYY-MM-DD format
      expect(result).toMatch(/Created on \d{4}-\d{2}-\d{2}\./);
    });

    it("replaces {{user}} and {{box_name}} with provided values", () => {
      const content = "Author: {{user}}, Box: {{box_name}}";
      const result = applyTemplate(content, {
        user: "Alice",
        box_name: "My Project",
      });
      expect(result).toBe("Author: Alice, Box: My Project");
    });

    it("replaces custom variables", () => {
      const content = "Sprint: {{sprint}}, Team: {{team}}";
      const result = applyTemplate(content, {
        sprint: "Sprint 42",
        team: "Platform",
      });
      expect(result).toBe("Sprint: Sprint 42, Team: Platform");
    });

    it("leaves unknown placeholders untouched", () => {
      const content = "Hello {{unknown_var}}.";
      const result = applyTemplate(content);
      expect(result).toBe("Hello {{unknown_var}}.");
    });

    it("handles content with no placeholders", () => {
      const content = "# Simple note\n\nNo variables here.";
      const result = applyTemplate(content);
      expect(result).toBe("# Simple note\n\nNo variables here.");
    });

    it("replaces multiple occurrences of the same variable", () => {
      const content = "{{user}} wrote this. Reviewed by {{user}}.";
      const result = applyTemplate(content, { user: "Bob" });
      expect(result).toBe("Bob wrote this. Reviewed by Bob.");
    });
  });

  describe("deleteTemplate", () => {
    it("deletes the template row", async () => {
      const sb = makeSupabase({ deleteError: null });

      await deleteTemplate(sb as any, "tpl-1");
      expect(sb.calls[0].table).toBe("note_templates");
      expect(sb.calls[0].op).toBe("delete");
      expect(sb.calls[0].filters).toContainEqual({ col: "id", val: "tpl-1" });
    });

    it("throws on delete error", async () => {
      const sb = makeSupabase({
        deleteError: { message: "RLS violation" },
      });

      await expect(deleteTemplate(sb as any, "tpl-1")).rejects.toThrow(
        "Failed to delete template: RLS violation"
      );
    });
  });
});
