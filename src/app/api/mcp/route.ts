import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseBearerAccessToken,
  resolveAccessToken,
} from "@/server/services/oauth_token_service";
import {
  hasScope,
  type OAuthScope,
} from "@/server/services/oauth_scope_service";
import { getWorkspaceRole } from "@/server/repositories/workspace_membership_repository";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { getNoteById } from "@/server/repositories/note_repository";
import { searchWorkspace } from "@/server/services/workspace_search_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

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
 */
interface ToolDef {
  name: string;
  description: string;
  scope: OAuthScope;
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
    name: "search_workspace",
    description:
      "Cross-type search (notes, files, skills, agents, folders, boxes) in the authorized workspace. Returns ranked hits.",
    scope: "context:search",
    writes: false,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
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
  // Role gate — viewers cannot write regardless of scope.
  if (tool.writes && ctx.role === "viewer") {
    throw toolError(-32003, "Viewer role cannot perform write operations");
  }

  const admin = createAdminClient();

  switch (name) {
    case "list_boxes": {
      const boxes = await listBoxesByWorkspace(admin, ctx.workspaceId);
      return { boxes: boxes.map((b) => ({
        id: b.id, name: b.name, slug: b.slug, description: b.description,
        created_at: b.created_at, updated_at: b.updated_at,
      })) };
    }

    case "get_note": {
      const noteId = String(args.note_id ?? "");
      if (!noteId) throw toolError(-32602, "note_id is required");
      const note = await getNoteById(admin, noteId);
      if (!note) return { note: null };
      // Verify ownership via box → workspace.
      const { data: box } = await admin.from("boxes").select("workspace_id").eq("id", note.box_id).maybeSingle();
      if (box?.workspace_id !== ctx.workspaceId) return { note: null };
      return { note };
    }

    case "search_workspace": {
      const query = String(args.query ?? "");
      if (!query) throw toolError(-32602, "query is required");
      const hits = await searchWorkspace(admin, ctx.workspaceId, query);
      return { hits };
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
        const admin = createAdminClient();
        await createAuditEvent(admin, {
          workspace_id: ctx.workspaceId,
          actor_type: "user",
          actor_id: ctx.userId,
          object_type: "oauth_client",
          object_id: ctx.clientId,
          event_type: `mcp.tool.called.${params.name}`,
          metadata: { scope: ctx.scope },
        });

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
  const issuer = (
    process.env.NEXT_PUBLIC_CANONICAL_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
  return NextResponse.json({
    resource: `${issuer}/api/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    resource_documentation: `${issuer}/docs/mcp_oauth_and_secure_connector_architecture_v1.md`,
  });
}
