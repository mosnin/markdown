import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client/canonical_api_client.js";
import { toErrorString } from "../errors.js";

// ─── create_write_proposal ────────────────────────────────────────────────────

/**
 * create_write_proposal
 *
 * Submits a write proposal for a human owner to review and approve or reject.
 *
 * Available to connections with permission_mode: propose_writes OR
 * generate_in_allowed_folders. Proposals never modify existing notes directly
 * — they create a pending record that the workspace owner reviews.
 *
 * Proposal types:
 *   create_note   — propose creating a new note in a folder (requires target_folder_id)
 *   update_note   — propose replacing note content (requires target_note_id)
 *   append_note   — propose appending markdown to a note (requires target_note_id)
 *   replace_note  — full destructive replacement (requires target_note_id; review UI warns)
 *
 * Conflict detection: the current note version is captured at proposal creation
 * time. If the note is edited before the proposal is approved, the proposal
 * becomes conflicted rather than overwriting the newer state.
 */
export function registerCreateWriteProposalTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "create_write_proposal",
    {
      description:
        "Submits a write proposal to the human workspace owner for review. " +
        "Proposals are NEVER applied automatically — the owner must explicitly approve. " +
        "Use create_note to propose a new note in a specific folder. " +
        "Use update_note or append_note to propose changes to an existing note. " +
        "Use replace_note for full destructive replacement (shown with stronger warning). " +
        "The owner will see the proposal type, proposed content, your rationale, " +
        "and the current note state side-by-side before deciding.",
      inputSchema: {
        proposal_type: z
          .enum(["create_note", "update_note", "append_note", "replace_note"])
          .describe("Type of write proposal"),

        target_note_id: z
          .string()
          .optional()
          .describe(
            "ID of the note to modify. Required for update_note, append_note, replace_note."
          ),

        target_folder_id: z
          .string()
          .optional()
          .describe(
            "ID of the folder to create the note in. Required for create_note."
          ),

        proposed_title: z
          .string()
          .optional()
          .describe("Proposed note title (optional for update/append)"),

        proposed_content: z
          .string()
          .optional()
          .describe(
            "Proposed markdown content. For append_note, this is the text to append. " +
            "For create_note / update_note / replace_note, this is the full new body."
          ),

        proposed_summary: z
          .string()
          .optional()
          .describe("Proposed one-sentence summary for the note"),

        proposed_tags: z
          .array(z.string())
          .optional()
          .describe("Proposed tags for the note"),

        rationale: z
          .string()
          .optional()
          .describe(
            "Your reasoning for this change. Visible to the reviewer. " +
            "A clear rationale helps the owner make an informed decision."
          ),
      },
    },
    async ({
      proposal_type,
      target_note_id,
      target_folder_id,
      proposed_title,
      proposed_content,
      proposed_summary,
      proposed_tags,
      rationale,
    }) => {
      try {
        const proposal = await client.createWriteProposal({
          proposal_type,
          target_note_id: target_note_id ?? null,
          target_folder_id: target_folder_id ?? null,
          proposed_title: proposed_title ?? null,
          proposed_content: proposed_content ?? null,
          proposed_summary: proposed_summary ?? null,
          proposed_tags: proposed_tags ?? null,
          rationale: rationale ?? null,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  proposal_id: proposal.id,
                  status: proposal.status,
                  proposal_type: proposal.proposal_type,
                  created_at: proposal.created_at,
                  message:
                    "Proposal submitted. The workspace owner will review and approve or reject it.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: toErrorString(err) }],
        };
      }
    }
  );
}

// ─── list_write_proposals ─────────────────────────────────────────────────────

/**
 * list_write_proposals
 *
 * Lists write proposals created by this connection.
 * Use this to check the status of previously submitted proposals.
 */
export function registerListWriteProposalsTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "list_write_proposals",
    {
      description:
        "Lists write proposals created by this connection. " +
        "Use this to check whether previous proposals have been approved, " +
        "rejected, or are still pending. Only proposals from this connection " +
        "are returned — you cannot see proposals from other connections.",
      inputSchema: {
        status: z
          .enum([
            "pending",
            "approved",
            "rejected",
            "conflicted",
            "canceled",
            "expired",
          ])
          .optional()
          .describe("Filter by proposal status"),

        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum proposals to return (default 50, max 100)"),

        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Page number for pagination (default 1)"),
      },
    },
    async ({ status, limit, page }) => {
      try {
        const result = await client.listWriteProposals({
          status,
          limit,
          page,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: toErrorString(err) }],
        };
      }
    }
  );
}

// ─── create_generated_note ────────────────────────────────────────────────────

/**
 * create_generated_note
 *
 * Creates a machine-authored note directly in a folder, without requiring
 * human review. The note is permanently marked as generated and attributed
 * to this connection.
 *
 * Requirements:
 * - Connection permission_mode must be generate_in_allowed_folders
 * - The folder must have accepts_generated_notes = true
 * - The folder's box must be in this connection's scope
 *
 * This path is for high-confidence content (e.g. structured summaries,
 * reference data, ingest outputs) that the workspace owner has pre-authorized
 * via the folder policy. For uncertain or editorial content, use
 * create_write_proposal instead so the owner can review.
 */
export function registerCreateGeneratedNoteTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "create_generated_note",
    {
      description:
        "Creates a machine-authored note directly in an allowed folder, without " +
        "requiring human review. Only available when the connection has " +
        "generate_in_allowed_folders permission AND the target folder has " +
        "accepts_generated_notes enabled by the workspace owner. " +
        "The note is marked is_generated=true and attributed to this connection. " +
        "Use create_write_proposal instead if the content needs human review first.",
      inputSchema: {
        folder_id: z
          .string()
          .describe(
            "ID of the target folder. Must have accepts_generated_notes = true."
          ),

        title: z
          .string()
          .optional()
          .describe(
            "Note title. If omitted, a default title is generated from the " +
            "connection name and current timestamp."
          ),

        markdown_content: z
          .string()
          .optional()
          .describe("Full markdown content of the note"),

        summary: z
          .string()
          .optional()
          .describe("One-sentence summary for retrieval and overview"),

        tags: z
          .array(z.string())
          .optional()
          .describe("Tags for the note"),

        read_hint: z
          .string()
          .optional()
          .describe(
            "Hint for AI retrieval about how to read this note. " +
            "Defaults to 'generated'."
          ),

        retrieval_priority: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("Retrieval priority 0–10 (default 0)"),
      },
    },
    async ({
      folder_id,
      title,
      markdown_content,
      summary,
      tags,
      read_hint,
      retrieval_priority,
    }) => {
      try {
        const result = await client.createGeneratedNote({
          folder_id,
          title: title ?? null,
          markdown_content: markdown_content ?? null,
          summary: summary ?? null,
          tags: tags ?? null,
          read_hint: read_hint ?? null,
          retrieval_priority,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  note_id: result.note.id,
                  title: result.note.title,
                  slug: result.note.slug,
                  path_cache: result.note.path_cache,
                  version_id: result.version_id,
                  is_generated: result.note.is_generated,
                  created_at: result.note.created_at,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: toErrorString(err) }],
        };
      }
    }
  );
}
