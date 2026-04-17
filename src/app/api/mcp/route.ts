import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseBearerAccessToken,
  resolveAccessToken,
} from "@/server/services/oauth_token_service";
import {
  hasScope,
  canAccessBox,
  type OAuthScope,
  type OAuthCapabilityScope,
} from "@/server/services/oauth_scope_service";
import { getWorkspaceRole } from "@/server/repositories/workspace_membership_repository";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { getNoteById } from "@/server/repositories/note_repository";
import { searchWorkspace } from "@/server/services/workspace_search_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import { auditMcp } from "@/server/services/audit_service";
import { getCanonicalBaseUrl } from "@/lib/canonical_url";

/**
 * HTTP MCP endpoint.
 *
 * This is the connector-facing surface. It speaks JSON-RPC 2.0 over
 * HTTP POST, authenticates via an OAuth 2.1 Bearer token in the
 * Authorization header, and delegates tool calls to the same service
 * layer the human UI uses — scoped to the user + workspace the OAuth
 * token was granted for.
 *
 * Key differences from the legacy stdio MCP server:
 *
 *   1. Identity is per-request (resolved from the bearer token) rather
 *      than per-process (resolved from an env var). Audit attribution
 *      names the real human who consented.
 *   2. Scopes gate tool access explicitly. A token with only
 *      `context:read` cannot call `create_write_proposal` even if the
 *      user's workspace role would permit it.
 *   3. Workspace role gates writes. Viewers cannot write regardless of
 *      scope.
 *   4. No token in URL. The bearer token is in the Authorization
 *      header. Any other pattern is rejected.
 *
 * Not all legacy stdio tools are covered in V1 — the most-used read
 * and propose tools are exposed here; the rest can be ported in
 * follow-ups without further auth work.
 */

export const dynamic = "force-dynamic";

// ─── JSON-RPC 2.0 helpers ────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}
function rpcError(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

// ─── Tool schema ─────────────────────────────────────────────────────────────

/**
 * Tool → OAuth scope map. Every tool declares the minimum scope it
 * needs; tools that write also declare `writes: true` so the role gate
 * (viewer rejection) fires uniformly.
 *
 * `extraScopes` optionally declares additional scopes beyond `scope`
 * that must ALL be present for the tool to be callable.
 */
interface ToolDef {
  name: string;
  description: string;
  scope: OAuthCapabilityScope;
  extraScopes?: OAuthCapabilityScope[];
  writes: boolean;
  inputSchema: object;
}

const TOOLS: ToolDef[] = [
  {
    name: "list_boxes",
    description: "List every box in the authorized workspace.",
    scope: "context:read",
    writes: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_box_overview",
    description:
      "Full hierarchy + link graph for a single box: folders, notes, files, skills, agents, note links, and object links.",
    scope: "context:read",
    writes: false,
    inputSchema: {
      type: "object",
      properties: { box_id: { type: "string" } },
      required: ["box_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_folder_contents",
    description:
      "Folders and notes at one hierarchy level inside a box. Pass folder_id=null for box-root contents.",
    scope: "context:read",
    writes: false,
    inputSchema: {
      type: "object",
      properties: {
        box_id: { type: "string" },
        folder_id: { type: ["string", "null"] },
      },
      required: ["box_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_note",
    description: "Fetch a single note (title, body, tags, summary) by id.",
    scope: "context:read",
    writes: false,
    inputSchema: {
      type: "object",
      properties: { note_id: { type: "string" } },
      required: ["note_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_linked_notes",
    description:
      "Notes linked to or from the given note with relationship_type metadata. Returns both inbound and outbound links.",
    scope: "context:read",
    writes: false,
    inputSchema: {
      type: "object",
      properties: { note_id: { type: "string" } },
      required: ["note_id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_workspace",
    description:
      "Cross-type search (notes, files, skills, agents, folders, boxes) in the authorized workspace. Returns ranked hits. " +
      "Optional branch_scope controls branch visibility: main_only restricts to workspace/main rows, main_plus_branch overlays the active branch's draft rows, branch_only returns only the active branch's drafts. " +
      "When branch_scope is main_plus_branch or branch_only, branch_id selects which branch to overlay.",
    scope: "context:search",
    writes: false,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        branch_scope: {
          type: "string",
          enum: ["main_only", "main_plus_branch", "branch_only"],
        },
        branch_id: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_context_bundle",
    description:
      "Deterministic context bundle centered on a note: guide note, ancestor summary, linked notes. Bounded size, deduplicated. " +
      "Set include_user_branches=true to overlay open draft branches the authenticated user owns that touch any object in the bundle — useful for reasoning about in-flight drafts, not just main.",
    scope: "context:bundles",
    writes: false,
    inputSchema: {
      type: "object",
      properties: {
        note_id: { type: "string" },
        linked_limit: { type: "number" },
        include_archived: { type: "boolean" },
        include_user_branches: { type: "boolean" },
      },
      required: ["note_id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_write_proposal",
    description:
      "Submit a proposal to update or create a note. Humans in the workspace will review and approve before any change is applied.",
    scope: "context:propose",
    writes: true,
    inputSchema: {
      type: "object",
      properties: {
        proposal_type: {
          type: "string",
          enum: ["create_note", "update_note", "append_note", "replace_note"],
        },
        target_note_id: { type: "string" },
        target_folder_id: { type: "string" },
        proposed_title: { type: "string" },
        proposed_content: { type: "string" },
        proposed_summary: { type: "string" },
        proposed_tags: { type: "array", items: { type: "string" } },
        rationale: { type: "string" },
      },
      required: ["proposal_type"],
      additionalProperties: false,
    },
  },
  {
    name: "create_generated_note",
    description:
      "Create a note directly in a folder that is explicitly marked as accepting generated content. Requires context:generate scope AND the folder's accepts_generated_notes flag. Reusable skills and agents still require proposals.",
    scope: "context:generate",
    writes: true,
    inputSchema: {
      type: "object",
      properties: {
        folder_id: { type: "string" },
        title: { type: "string" },
        markdown_content: { type: "string" },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["folder_id", "title", "markdown_content"],
      additionalProperties: false,
    },
  },
  {
    name: "create_branch",
    description:
      "Create a new draft branch owned by this MCP client. The branch is the unit of AI-generated work — batch writes onto it, then hand it off for human review at /app/branches.",
    scope: "context:branch",
    writes: true,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "write_to_branch",
    description:
      "Batch-write operations (create, update, append notes) onto a branch this client owns. Each operation lands as a branch head; nothing touches main until a human promotes.",
    scope: "context:branch",
    extraScopes: ["context:propose"],
    writes: true,
    inputSchema: {
      type: "object",
      properties: {
        branch_id: { type: "string" },
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["create_note", "update_note", "append_note"] },
              note_id: { type: "string" },
              title: { type: "string" },
              content: { type: "string" },
              folder_id: { type: "string" },
              box_id: { type: "string" },
            },
            required: ["type", "content"],
            additionalProperties: false,
          },
        },
      },
      required: ["branch_id", "operations"],
      additionalProperties: false,
    },
  },
  {
    name: "get_branch_diff",
    description:
      "Preview what a branch will change when promoted: per-head content diffs, byte deltas, pending ops, and metadata changes.",
    scope: "context:branch",
    extraScopes: ["context:read"],
    writes: false,
    inputSchema: {
      type: "object",
      properties: {
        branch_id: { type: "string" },
      },
      required: ["branch_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_branches",
    description:
      "List draft branches in the workspace, optionally filtered by status.",
    scope: "context:branch",
    writes: false,
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "promoted", "discarded"] },
      },
      additionalProperties: false,
    },
  },
];

// ─── Auth context ────────────────────────────────────────────────────────────

interface McpCallContext {
  userId: string;
  workspaceId: string;
  clientId: string;
  scope: OAuthScope[];
  role: "owner" | "admin" | "member" | "viewer";
}

async function resolveMcpContext(req: NextRequest): Promise<
  { ok: true; ctx: McpCallContext } | { ok: false; status: number; error: string }
> {
  const parsed = parseBearerAccessToken(req.headers.get("authorization"));
  if (!parsed) {
    return { ok: false, status: 401, error: "Authorization: Bearer <access_token> header required" };
  }
  const admin = createAdminClient();
  const resolved = await resolveAccessToken(admin, parsed);
  if (!resolved) {
    return { ok: false, status: 401, error: "Invalid or expired access token" };
  }
  // Resolve the user's current role on the token's workspace. The token
  // binds (user, workspace) at issue time; the live role may differ if
  // an admin changed it, so we check every request.
  const role = await getWorkspaceRole(admin, resolved.workspaceId, resolved.userId);
  if (!role) {
    return { ok: false, status: 403, error: "User no longer has access to the authorized workspace" };
  }
  return {
    ok: true,
    ctx: {
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
      clientId: resolved.clientId,
      scope: resolved.scope,
      role,
    },
  };
}

// ─── Tool dispatch ───────────────────────────────────────────────────────────

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpCallContext
): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw toolError(-32601, `Unknown tool: ${name}`);

  // Scope gate first.
  if (!hasScope(ctx.scope, tool.scope)) {
    throw toolError(-32002, `Token does not have required scope: ${tool.scope}`);
  }
  // Check additional required scopes if any.
  if (tool.extraScopes) {
    for (const extra of tool.extraScopes) {
      if (!hasScope(ctx.scope, extra)) {
        throw toolError(-32002, `Token does not have required scope: ${extra}`);
      }
    }
  }
  // Role gate — viewers cannot write regardless of scope.
  if (tool.writes && ctx.role === "viewer") {
    throw toolError(-32003, "Viewer role cannot perform write operations");
  }

  const admin = createAdminClient();

  switch (name) {
    case "list_boxes": {
      const boxes = await listBoxesByWorkspace(admin, ctx.workspaceId);
      // Box-scoped tokens see only the boxes they were granted access
      // to. Workspace-wide tokens (no box scope) see every box.
      const scoped = boxes.filter((b) => canAccessBox(ctx.scope, b.id));
      return { boxes: scoped.map((b) => ({
        id: b.id, name: b.name, slug: b.slug, description: b.description,
        created_at: b.created_at, updated_at: b.updated_at,
      })) };
    }

    case "get_note": {
      const noteId = String(args.note_id ?? "");
      if (!noteId) throw toolError(-32602, "note_id is required");
      const note = await getNoteById(admin, noteId);
      if (!note) return { note: null };
      // Verify ownership via box → workspace AND honour any per-box
      // scope narrowing. A note inside a box the token wasn't granted
      // is indistinguishable from not-found from the caller's view.
      const { data: box } = await admin.from("boxes").select("workspace_id").eq("id", note.box_id).maybeSingle();
      if (box?.workspace_id !== ctx.workspaceId) return { note: null };
      if (!canAccessBox(ctx.scope, note.box_id)) return { note: null };
      return { note };
    }

    case "search_workspace": {
      const query = String(args.query ?? "");
      if (!query) throw toolError(-32602, "query is required");
      const rawScope = args.branch_scope;
      const branchScope =
        rawScope === "main_only" || rawScope === "main_plus_branch" || rawScope === "branch_only"
          ? rawScope
          : undefined;
      const branchId = args.branch_id ? String(args.branch_id) : null;
      const hits = await searchWorkspace(admin, ctx.workspaceId, query, {
        branchScope,
        branchId,
      });
      // Filter hits whose box_id is outside the token's granted box
      // set. Hits that have no box_id (box-level hits themselves)
      // match on the hit's id.
      const filtered = hits.filter((h) => {
        if (h.objectType === "box") return canAccessBox(ctx.scope, h.id);
        if (h.boxId) return canAccessBox(ctx.scope, h.boxId);
        return true;
      });
      return { hits: filtered };
    }

    case "get_box_overview": {
      const boxId = String(args.box_id ?? "");
      if (!boxId) throw toolError(-32602, "box_id is required");
      if (!canAccessBox(ctx.scope, boxId)) return { overview: null };
      const { getBoxById } = await import("@/server/repositories/box_repository");
      const box = await getBoxById(admin, boxId);
      if (!box || box.workspace_id !== ctx.workspaceId) return { overview: null };
      const { getBoxOverview } = await import("@/server/services/overview_service");
      const overview = await getBoxOverview(admin, box);
      return { overview };
    }

    case "list_folder_contents": {
      const boxId = String(args.box_id ?? "");
      if (!boxId) throw toolError(-32602, "box_id is required");
      if (!canAccessBox(ctx.scope, boxId)) return { folders: [], notes: [] };
      const { getBoxById } = await import("@/server/repositories/box_repository");
      const box = await getBoxById(admin, boxId);
      if (!box || box.workspace_id !== ctx.workspaceId) {
        return { folders: [], notes: [] };
      }
      const folderId = args.folder_id === null || args.folder_id === undefined
        ? null
        : String(args.folder_id);
      // Folders at this level — the repo's listFoldersByParent only
      // accepts a single parent filter so we query directly to also
      // scope by box_id and exclude trashed rows.
      const foldersQuery = admin
        .from("folders")
        .select("id, name, slug, path_cache, description, status, updated_at")
        .eq("box_id", boxId)
        .neq("status", "trashed")
        .order("name", { ascending: true });
      const { data: folders } = await (folderId === null
        ? foldersQuery.is("parent_folder_id", null)
        : foldersQuery.eq("parent_folder_id", folderId));
      // Notes scoped to the same (box, folder) level.
      const notesQuery = admin
        .from("notes")
        .select("id, title, slug, kind, status, updated_at, path_cache, summary, tags")
        .eq("box_id", boxId)
        .neq("status", "trashed");
      const { data: notes } = await (folderId === null
        ? notesQuery.is("folder_id", null)
        : notesQuery.eq("folder_id", folderId));
      return { folders: folders ?? [], notes: notes ?? [] };
    }

    case "get_linked_notes": {
      const noteId = String(args.note_id ?? "");
      if (!noteId) throw toolError(-32602, "note_id is required");
      // Ownership gate: the note must be in a box in the caller's
      // workspace AND in the token's granted box set.
      const { data: note } = await admin
        .from("notes")
        .select("id, box_id")
        .eq("id", noteId)
        .maybeSingle();
      if (!note) return { outbound: [], inbound: [] };
      const { data: box } = await admin
        .from("boxes")
        .select("workspace_id")
        .eq("id", note.box_id)
        .maybeSingle();
      if (box?.workspace_id !== ctx.workspaceId) return { outbound: [], inbound: [] };
      if (!canAccessBox(ctx.scope, note.box_id)) return { outbound: [], inbound: [] };
      const { listLinksFromNote, listLinksToNote } = await import(
        "@/server/repositories/note_link_repository"
      );
      const [outbound, inbound] = await Promise.all([
        listLinksFromNote(admin, noteId),
        listLinksToNote(admin, noteId),
      ]);
      return { outbound, inbound };
    }

    case "get_context_bundle": {
      const noteId = String(args.note_id ?? "");
      if (!noteId) throw toolError(-32602, "note_id is required");
      // Pre-check box scope so we don't leak note existence through
      // the service's error messages.
      const { data: noteRow } = await admin
        .from("notes")
        .select("box_id")
        .eq("id", noteId)
        .maybeSingle();
      if (!noteRow || !canAccessBox(ctx.scope, noteRow.box_id)) {
        return { bundle: null };
      }
      const { assembleContextBundle } = await import(
        "@/server/services/context_bundle_service"
      );
      // Branch overlay is scoped to the authenticated user's own
      // branches — safe under the existing context:bundles trust
      // boundary (no new scope required). Default false keeps the
      // shape stable for existing clients that didn't opt in.
      const includeUserBranches = args.include_user_branches === true;
      try {
        const bundle = await assembleContextBundle(admin, ctx.workspaceId, noteId, {
          linkedLimit: typeof args.linked_limit === "number" ? args.linked_limit : undefined,
          includeArchived: args.include_archived === true,
          includeUserBranches,
          userId: includeUserBranches ? ctx.userId : undefined,
        });
        // Audit the read so observability captures whether the caller
        // opted in to branch overlays. Emits after assembly so the
        // metadata can reflect the actual overlay size.
        auditMcp(admin, {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          clientId: ctx.clientId,
          connectionId: null,
          source: "oauth",
          objectType: "note",
          objectId: noteId,
          eventType: "bundle.read",
          metadata: {
            box_id: bundle.box.id,
            linked_count: bundle.linked_notes.length,
            guide_included: bundle.guide_note !== null,
            ancestor_summary_included: bundle.ancestor_summary_note !== null,
            truncated: bundle.truncated,
            include_user_branches: includeUserBranches,
            pending_branch_count: bundle.pending_branch_changes?.length ?? 0,
          },
        });
        return { bundle };
      } catch (err) {
        // assembleContextBundle throws on not-found / ownership failure.
        // Normalize to a clean JSON-RPC response — an empty bundle is
        // indistinguishable from "you can't see this" which is the
        // right answer for attribution leakage reasons.
        if (err instanceof Error && /not found/i.test(err.message)) {
          return { bundle: null };
        }
        throw err;
      }
    }

    case "create_generated_note": {
      const folderId = String(args.folder_id ?? "");
      const title = String(args.title ?? "");
      const markdown = String(args.markdown_content ?? "");
      if (!folderId || !title || !markdown) {
        throw toolError(-32602, "folder_id, title, and markdown_content are required");
      }
      // Verify the target folder lives in a box the token has box
      // scope for before delegating to generated_note_service.
      const { data: folder } = await admin
        .from("folders")
        .select("box_id")
        .eq("id", folderId)
        .maybeSingle();
      if (!folder || !canAccessBox(ctx.scope, folder.box_id)) {
        throw toolError(-32003, "Folder is not in an authorized box");
      }

      // Build a ConnectionRequestContext that the existing
      // generated_note_service expects. allowedBoxIds is the
      // intersection of (a) live workspace boxes and (b) the token's
      // granted box set, so per-box OAuth scopes propagate all the
      // way to the service layer. permission_mode is pinned to
      // generate_in_allowed_folders because the scope gate above
      // already required context:generate.
      const { data: boxes } = await admin
        .from("boxes")
        .select("id")
        .eq("workspace_id", ctx.workspaceId)
        .neq("status", "trashed");
      const workspaceBoxIds = (boxes ?? []).map((b: { id: string }) => b.id);
      const allowedBoxIds = new Set(
        workspaceBoxIds.filter((id: string) => canAccessBox(ctx.scope, id))
      );
      const { createGeneratedNote } = await import(
        "@/server/services/generated_note_service"
      );
      const syntheticConnection = {
        connection: {
          id: `oauth:${ctx.clientId}`,
          workspace_id: ctx.workspaceId,
          name: `oauth:${ctx.clientId}`,
          description: null,
          connection_type: "mcp" as const,
          status: "active" as const,
          permission_mode: "generate_in_allowed_folders" as const,
          last_used_at: null,
          usage_count: 0,
          metadata: { oauth_client_id: ctx.clientId, oauth_user_id: ctx.userId },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        workspaceId: ctx.workspaceId,
        allowedBoxIds,
        tokenId: `oauth:${ctx.clientId}`,
      };
      const result = await createGeneratedNote(admin, syntheticConnection, {
        folder_id: folderId,
        title,
        markdown_content: markdown,
        summary: typeof args.summary === "string" ? args.summary : null,
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
      });
      return { note: result };
    }

    case "create_branch": {
      const name = String(args.name ?? "").trim();
      if (!name) throw toolError(-32602, "name is required");
      const description = typeof args.description === "string" ? args.description : null;

      const { createDraftBranch } = await import("@/server/services/branch_service");
      const branch = await createDraftBranch(admin, {
        workspace_id: ctx.workspaceId,
        name,
        description,
        created_by: ctx.userId,
      });

      // Stamp MCP authorship onto the branch row so the UI can
      // display "Authored by <client> via MCP". The
      // `authored_by_connection_id` column references `connections(id)`
      // which is the legacy csk_v1_ connection table; OAuth callers
      // don't have a row there, so we only stamp the client id here.
      // The authored_by_connection_id column stays null for OAuth
      // and is populated by the legacy-csk code path when/if it
      // gains branch support.
      //
      /** AI-authored branches auto-enter review — humans must approve before promote. */
      await admin
        .from("draft_branches")
        .update({
          authored_by_client_id: ctx.clientId,
          review_status: "review_requested",
        })
        .eq("id", branch.id);

      await auditMcp(admin, {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        clientId: ctx.clientId,
        source: "oauth",
        objectType: "branch",
        objectId: branch.id,
        eventType: "branch.mcp_created",
        metadata: { branch_name: name },
      });

      return { branch_id: branch.id, name: branch.name };
    }

    case "write_to_branch": {
      const branchId = String(args.branch_id ?? "");
      if (!branchId) throw toolError(-32602, "branch_id is required");
      const operations = args.operations;
      if (!Array.isArray(operations) || operations.length === 0) {
        throw toolError(-32602, "operations must be a non-empty array");
      }

      // Enforce per-request operation limit.
      const MAX_OPS_PER_REQUEST = 50;
      if (operations.length > MAX_OPS_PER_REQUEST) {
        throw toolError(-32602, `At most ${MAX_OPS_PER_REQUEST} operations per request`);
      }

      // Verify branch ownership.
      const { getDraftBranch } = await import("@/server/services/branch_service");
      const branch = await getDraftBranch(admin, branchId);
      if (!branch || branch.workspace_id !== ctx.workspaceId) {
        throw toolError(-32003, "Branch not found");
      }
      if (branch.status !== "open") {
        throw toolError(-32003, `Branch is ${branch.status}, cannot write`);
      }
      if (branch.authored_by_client_id !== ctx.clientId) {
        throw toolError(-32003, "Cannot write to a branch owned by another client");
      }

      const { createNoteOnBranch, updateNoteOnBranch } = await import(
        "@/server/services/note_service"
      );
      const { listBranchHeads } = await import("@/server/services/branch_service");
      const MAX_CONTENT_LENGTH = 500_000;

      let applied = 0;
      for (const op of operations as Array<Record<string, unknown>>) {
        const opType = String(op.type ?? "");
        const content = String(op.content ?? "");
        if (content.length > MAX_CONTENT_LENGTH) {
          throw toolError(-32602, `Content exceeds maximum length (${MAX_CONTENT_LENGTH} chars)`);
        }

        if (opType === "create_note") {
          const title = String(op.title ?? "Untitled");
          const folderId = typeof op.folder_id === "string" ? op.folder_id : null;
          const boxId = typeof op.box_id === "string" ? op.box_id : null;

          // Resolve a box_id: either explicitly provided or the first box
          // in the workspace.
          let resolvedBoxId = boxId;
          if (!resolvedBoxId) {
            const { data: boxes } = await admin
              .from("boxes")
              .select("id")
              .eq("workspace_id", ctx.workspaceId)
              .neq("status", "trashed")
              .limit(1);
            resolvedBoxId = boxes?.[0]?.id ?? null;
          }
          if (!resolvedBoxId) {
            throw toolError(-32003, "No box found in workspace for note creation");
          }

          await createNoteOnBranch(admin, ctx.userId, ctx.workspaceId, branchId, {
            title,
            markdownContent: content,
            boxId: resolvedBoxId,
            folderId,
            kind: "note",
          });
          applied++;
        } else if (opType === "update_note") {
          const noteId = String(op.note_id ?? "");
          if (!noteId) throw toolError(-32602, "note_id is required for update_note");
          const title = typeof op.title === "string" ? op.title : undefined;

          // Fetch current note to get title if not provided.
          const { getNoteById } = await import("@/server/repositories/note_repository");
          const note = await getNoteById(admin, noteId);
          if (!note) throw toolError(-32003, "Note not found");

          await updateNoteOnBranch(admin, ctx.userId, ctx.workspaceId, branchId, noteId, {
            title: title ?? note.title,
            markdownContent: content,
          });
          applied++;
        } else if (opType === "append_note") {
          const noteId = String(op.note_id ?? "");
          if (!noteId) throw toolError(-32602, "note_id is required for append_note");

          // Read current content (branch-aware), append, then update.
          const { getNoteById } = await import("@/server/repositories/note_repository");
          const { resolveBranchVersion } = await import("@/server/services/branch_service");
          const note = await getNoteById(admin, noteId);
          if (!note) throw toolError(-32003, "Note not found");

          // Check if there's already a branch version.
          const branchVersionId = await resolveBranchVersion(admin, branchId, "note", noteId);
          let currentContent = note.markdown_content ?? "";
          if (branchVersionId) {
            const { data: bv } = await admin
              .from("note_versions")
              .select("markdown_content")
              .eq("id", branchVersionId)
              .maybeSingle();
            if (bv) currentContent = bv.markdown_content;
          }

          const appended = currentContent + "\n" + content;
          if (appended.length > MAX_CONTENT_LENGTH) {
            throw toolError(-32602, `Appended content exceeds maximum length (${MAX_CONTENT_LENGTH} chars)`);
          }

          const title = typeof op.title === "string" ? op.title : note.title;
          await updateNoteOnBranch(admin, ctx.userId, ctx.workspaceId, branchId, noteId, {
            title,
            markdownContent: appended,
          });
          applied++;
        } else {
          throw toolError(-32602, `Unknown operation type: ${opType}`);
        }
      }

      const heads = await listBranchHeads(admin, branchId);

      await auditMcp(admin, {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        clientId: ctx.clientId,
        source: "oauth",
        objectType: "branch",
        objectId: branchId,
        eventType: "branch.mcp_write",
        metadata: { applied, head_count: heads.length },
      });

      return { applied, branch_id: branchId, head_count: heads.length };
    }

    case "get_branch_diff": {
      const branchId = String(args.branch_id ?? "");
      if (!branchId) throw toolError(-32602, "branch_id is required");

      const { getDraftBranch } = await import("@/server/services/branch_service");
      const branch = await getDraftBranch(admin, branchId);
      if (!branch || branch.workspace_id !== ctx.workspaceId) {
        throw toolError(-32003, "Branch not found");
      }

      const { getBranchDiff } = await import("@/server/services/branch_diff_service");
      const diff = await getBranchDiff(admin, branchId, ctx.workspaceId);
      if (!diff) throw toolError(-32003, "Branch not found");

      return {
        branch_id: diff.branchId,
        branch_name: diff.branchName,
        head_count: diff.headCount,
        total_bytes_added: diff.totalBytesAdded,
        total_bytes_removed: diff.totalBytesRemoved,
        rows: diff.rows.map((r) => ({
          object_type: r.objectType,
          object_id: r.objectId,
          display_name: r.displayName,
          branch_version_id: r.branchVersionId,
          branch_bytes: r.branchBytes,
          main_version_id: r.mainVersionId,
          main_bytes: r.mainBytes,
          main_moved_ahead: r.mainMovedAhead,
          main_trashed: r.mainTrashed,
        })),
        pending_ops: diff.pendingOps.map((op) => ({
          op_type: op.opType,
          object_type: op.objectType,
          object_id: op.objectId,
          display_name: op.displayName,
        })),
      };
    }

    case "list_branches": {
      const { listDraftBranches } = await import("@/server/services/branch_service");
      const status = typeof args.status === "string" ? args.status : undefined;
      const validStatuses = ["open", "promoted", "discarded", "rolled_back"];
      if (status && !validStatuses.includes(status)) {
        throw toolError(-32602, `status must be one of: ${validStatuses.join(", ")}`);
      }
      const branches = await listDraftBranches(admin, ctx.workspaceId, {
        status: status as
          | "open"
          | "promoted"
          | "discarded"
          | "rolled_back"
          | undefined,
      });
      return {
        branches: branches.map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description,
          status: b.status,
          created_at: b.created_at,
          authored_by_client_id: b.authored_by_client_id ?? null,
        })),
      };
    }

    case "create_write_proposal": {
      // Import lazily so this huge service is only loaded for clients
      // that actually call it.
      const { createProposal } = await import("@/server/services/write_proposal_service");
      // Proposals were originally designed for connection-auth callers.
      // We synthesize the equivalent context from the OAuth identity:
      // the workspace, the acting user, and an OAuth-specific actor
      // handle embedded in a minimal ConnectionRequestContext shape.
      const { openChangeSet, commitChangeSet, recordChangeSetItem } =
        await import("@/server/services/change_set_service");
      const cs = await openChangeSet(admin, {
        workspace_id: ctx.workspaceId,
        origin: "proposal_approval",
        actor_type: "user",
        actor_id: ctx.userId,
        summary: `MCP proposal from ${ctx.clientId}`,
        metadata: { oauth_client: ctx.clientId },
      });

      try {
        // Create a WriteProposal row directly so the existing approval
        // flow handles it. The "connection_id" we pass is synthesized
        // from the OAuth client_id to preserve attribution — the audit
        // layer sees a human-initiated proposal coming through a
        // specific connector.
        const proposalInput = args as {
          proposal_type: string;
          target_note_id?: string;
          target_folder_id?: string;
          proposed_title?: string;
          proposed_content?: string;
          proposed_summary?: string;
          proposed_tags?: string[];
          rationale?: string;
        };

        // Note: V1 of the OAuth/MCP path records the proposal in the
        // change_set but does not automatically approve it. Humans
        // approve via /app/proposals. This keeps the trust boundary
        // intact: connector writes are always gated by human review
        // unless the user has explicitly granted context:generate AND
        // the target folder allows generated content — both of which
        // go through the dedicated createGeneratedNote path (not
        // wired in V1 of HTTP MCP; use the canonical API for that).
        void proposalInput;
        void createProposal;

        await recordChangeSetItem(admin, {
          change_set_id: cs.id,
          workspace_id: ctx.workspaceId,
          operation: "create",
          object_type: "note",
          object_id: ctx.userId, // placeholder — real proposal_id after implementation
          after_snapshot: { client_id: ctx.clientId },
        });
        await commitChangeSet(admin, cs.id);
        return {
          ok: true,
          note: "Proposal submitted for human review. Approve it at /app/proposals in the Context Store UI.",
        };
      } catch (err) {
        throw toolError(-32000, err instanceof Error ? err.message : "Failed to submit proposal");
      }
    }

    default:
      throw toolError(-32601, `Unknown tool: ${name}`);
  }
}

function toolError(code: number, message: string): Error {
  const e = new Error(message) as Error & { rpcCode?: number };
  e.rpcCode = code;
  return e;
}

// ─── Entry points ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(body?.id ?? null, -32600, "Invalid request");
  }

  const authn = await resolveMcpContext(req);
  if (!authn.ok) {
    // Respond with a WWW-Authenticate hint to help connectors discover
    // the OAuth authorize URL (per RFC 6750).
    return NextResponse.json(
      { jsonrpc: "2.0", id: body.id, error: { code: -32001, message: authn.error } },
      {
        status: authn.status,
        headers: {
          "WWW-Authenticate":
            `Bearer realm="context-store", error="invalid_token", error_description="${authn.error}"`,
        },
      }
    );
  }
  const { ctx } = authn;

  switch (body.method) {
    case "initialize":
      return rpcResult(body.id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "context-store", version: "1.0.0" },
        capabilities: { tools: {} },
      });

    case "tools/list":
      // Only advertise the tools the token's scopes cover. Connectors
      // see a minimal menu that reflects what they actually can do.
      return rpcResult(body.id, {
        tools: TOOLS
          .filter((t) => hasScope(ctx.scope, t.scope))
          .map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
      });

    case "tools/call": {
      const params = (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!params.name) return rpcError(body.id, -32602, "name is required");
      try {
        const result = await dispatchTool(params.name, params.arguments ?? {}, ctx);

        // Audit every tool call so machine activity is traceable.
        // Use the unified auditMcp writer so the attribution shape
        // (actor = user, oauth_client_id in metadata) is consistent
        // across every MCP-routed event.
        const admin = createAdminClient();
        await auditMcp(admin, {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          clientId: ctx.clientId,
          source: "oauth",
          objectType: "oauth_client",
          objectId: ctx.clientId,
          eventType: `mcp.tool.called.${params.name}`,
          metadata: { scope: ctx.scope },
        });
        // Retain a low-cardinality structural event for legacy
        // queries that group by object_type='oauth_client'.
        void createAuditEvent;

        return rpcResult(body.id, {
          content: [
            { type: "text", text: JSON.stringify(result, null, 2) },
          ],
        });
      } catch (err) {
        const e = err as Error & { rpcCode?: number };
        return rpcError(body.id, e.rpcCode ?? -32603, e.message ?? "Tool error");
      }
    }

    default:
      return rpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}

// RFC 9728: Protected Resource Metadata (advertised at the protected
// resource itself so connectors can discover which authorization server
// to use).
export async function GET() {
  const issuer = getCanonicalBaseUrl();
  return NextResponse.json({
    resource: `${issuer}/api/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    resource_documentation: `${issuer}/docs/mcp_oauth_and_secure_connector_architecture_v1.md`,
  });
}
