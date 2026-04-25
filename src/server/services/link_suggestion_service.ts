import { type SupabaseClient } from "@supabase/supabase-js";
import { type RelationshipType, RELATIONSHIP_TYPE } from "@/server/domain/constants/note_constants";
import { getNoteById } from "@/server/repositories/note_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import {
  checkRateLimit,
  type RateLimitOptions,
} from "@/server/services/rate_limit_service";
import { logger, log } from "@/lib/logger";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LinkSuggestion {
  targetNoteId: string;
  targetNoteTitle: string;
  suggestedRelationship: string;
  confidence: number;
  reason: string;
}

// ─── Rate limit config ──────────────────────────────────────────────────────

export const SUGGESTION_LIMIT: RateLimitOptions = {
  limit: 10,
  windowSeconds: 60 * 60, // 1 hour
};

export function suggestionBucketKey(userId: string): string {
  return `link_suggestions:user:${userId}`;
}

// ─── Valid relationship types ───────────────────────────────────────────────

const VALID_RELATIONSHIP_TYPES = new Set<string>(
  Object.values(RELATIONSHIP_TYPE)
);

// ─── Claude API caller ──────────────────────────────────────────────────────

interface CandidateNote {
  id: string;
  title: string;
  summary: string | null;
}

interface ClaudeSuggestion {
  target_note_id: string;
  suggested_relationship: string;
  confidence: number;
  reason: string;
}

async function callClaude(
  noteTitle: string,
  noteContent: string,
  candidates: CandidateNote[]
): Promise<ClaudeSuggestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const candidateList = candidates
    .map(
      (c) =>
        `- ID: ${c.id} | Title: "${c.title}" | Summary: ${c.summary ?? "(no summary)"}`
    )
    .join("\n");

  const validTypes = Object.values(RELATIONSHIP_TYPE).join(", ");

  const prompt = `You are a knowledge management assistant. Given a note and a list of candidate notes in the same collection, suggest up to 5 notes that should be linked to the given note.

For each suggestion, provide:
- target_note_id: the ID of the candidate note
- suggested_relationship: one of [${validTypes}]
- confidence: a number between 0 and 1 (0 = low, 1 = high)
- reason: a brief explanation of why these notes should be linked

Current note:
Title: "${noteTitle}"
Content:
${noteContent.slice(0, 3000)}

Candidate notes:
${candidateList}

Respond with ONLY a JSON array of suggestions (no markdown fencing, no explanation). If no good connections exist, respond with an empty array [].
Example: [{"target_note_id": "uuid", "suggested_relationship": "related", "confidence": 0.85, "reason": "Both discuss..."}]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch((err) => { logger.warn({ err }, "failed to read Claude API error response body"); return ""; });
    log.error("claude_api_error", {
      status: response.status,
      body: body.slice(0, 200),
    });
    return [];
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) return [];

  try {
    const parsed = JSON.parse(textBlock.text) as ClaudeSuggestion[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    log.warn("claude_response_parse_error", {
      text: textBlock.text.slice(0, 200),
    });
    return [];
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Analyze a note's content and suggest related notes to link to.
 *
 * Uses Claude API to find semantic connections. Returns an empty array
 * when ANTHROPIC_API_KEY is not set (graceful no-op).
 *
 * Rate-limited to 10 requests per user per hour.
 */
export async function suggestLinks(
  supabase: SupabaseClient,
  noteId: string,
  workspaceId: string,
  userId: string
): Promise<LinkSuggestion[]> {
  // Graceful no-op when API key is not configured
  if (!process.env.ANTHROPIC_API_KEY) {
    return [];
  }

  // Rate limit check
  const rateCheck = await checkRateLimit(
    supabase,
    suggestionBucketKey(userId),
    SUGGESTION_LIMIT
  );
  if (!rateCheck.allowed) {
    throw new Error(
      `Rate limit exceeded. Try again in ${rateCheck.retryAfterSeconds} seconds.`
    );
  }

  // Fetch the source note
  const note = await getNoteById(supabase, noteId);
  if (!note) {
    throw new Error("Note not found");
  }

  // Fetch other notes in the same box as candidates
  const allNotes = await listNotesByBox(supabase, note.box_id, {
    limit: 200,
  });
  const candidates: CandidateNote[] = allNotes
    .filter((n) => n.id !== noteId && n.status === "active")
    .map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
    }));

  if (candidates.length === 0) {
    return [];
  }

  // Call Claude API
  const rawSuggestions = await callClaude(
    note.title,
    note.markdown_content,
    candidates
  );

  // Validate and filter suggestions
  const candidateIds = new Set(candidates.map((c) => c.id));
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  const suggestions: LinkSuggestion[] = [];
  for (const raw of rawSuggestions.slice(0, 5)) {
    // Skip suggestions for notes not in our candidate set
    if (!candidateIds.has(raw.target_note_id)) continue;

    // Validate relationship type; default to 'related' if invalid
    const relationship = VALID_RELATIONSHIP_TYPES.has(raw.suggested_relationship)
      ? raw.suggested_relationship
      : "related";

    // Validate confidence score (clamp to 0-1)
    const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));

    const target = candidateMap.get(raw.target_note_id)!;
    suggestions.push({
      targetNoteId: raw.target_note_id,
      targetNoteTitle: target.title,
      suggestedRelationship: relationship,
      confidence,
      reason: typeof raw.reason === "string" ? raw.reason : "",
    });
  }

  return suggestions;
}

/**
 * Validate that a confidence score is within the valid range (0-1).
 * Exported for testing.
 */
export function validateConfidence(value: number): boolean {
  return typeof value === "number" && value >= 0 && value <= 1 && !isNaN(value);
}
