import { redactString, redactFilePaths } from "@/server/services/session_event_redaction";

/**
 * Transcript parsing and segmentation.
 *
 * Turns a raw agent transcript into retrievable segments. Pure functions only —
 * no database, no network — so the segmentation rules can be tested directly,
 * which matters because they encode the product's central opinion:
 *
 *   PRESERVE WHAT CANNOT BE RECONSTRUCTED. DROP WHAT CAN.
 *
 * An assistant's reasoning is gone forever when the process exits. A file's
 * contents are one tool call away. So reasoning is stored whole and tool output
 * is truncated hard — head and tail, because the useful parts of a failure are
 * the command that ran and the error at the end, never the 400 lines between.
 *
 * Robustness: every input here is a file written by a program we do not
 * control, possibly cut mid-line by incremental shipping, possibly from a
 * version whose schema has moved. Nothing throws. An unparseable line is
 * skipped; an unrecognised shape degrades to plain text. Losing fidelity beats
 * losing the transcript.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type SegmentRole = "user" | "assistant" | "system" | "tool";
export type SegmentKind =
  | "prompt"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "summary";

export interface ParsedSegment {
  role: SegmentRole;
  kind: SegmentKind;
  content: string;
  token_estimate: number;
  tool_name: string | null;
  files: string[];
  importance: number;
  truncated: boolean;
  occurred_at: string | null;
}

export type TranscriptFormat =
  | "claude_code_jsonl"
  | "codex_jsonl"
  | "plain"
  | "custom";

export interface ParseResult {
  segments: ParsedSegment[];
  /** Source messages recognised, whether or not they produced a segment. */
  messageCount: number;
  /**
   * Bytes safely consumed. A trailing partial line is excluded so the next
   * incremental send resumes at a line boundary rather than mid-JSON.
   */
  consumedBytes: number;
}

// ─── Tuning ─────────────────────────────────────────────────────────────────

/** Max characters in one segment before it is split. ~1500 tokens. */
const MAX_SEGMENT_CHARS = 6000;
/** Segments shorter than this merge into an adjacent one of the same kind. */
const MIN_SEGMENT_CHARS = 40;

/**
 * Tool output budget. Deliberately small: it is context, not content. If the
 * next agent needs the real output it can re-run the command, and re-running is
 * cheaper than storing every `cat` any agent has ever done.
 */
const TOOL_RESULT_HEAD_CHARS = 1200;
const TOOL_RESULT_TAIL_CHARS = 800;

/** Tool arguments are a hint, not a record. */
const TOOL_CALL_CHARS = 600;

/**
 * Salience per kind, on the same 0–5 scale as session_events.
 *
 * Reasoning sits at 4 and tool results at 1 for one reason: at retrieval time
 * we would rather surface a half-relevant explanation than a perfectly-matching
 * directory listing.
 */
const KIND_IMPORTANCE: Record<SegmentKind, number> = {
  prompt: 4,
  reasoning: 4,
  summary: 5,
  tool_call: 2,
  tool_result: 1,
};

/** Four characters per token — the same rough ratio the brief assembler uses. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Truncation ─────────────────────────────────────────────────────────────

/**
 * Cut a long tool result down to its informative ends.
 *
 * Keeps the head (what ran, how it started) and the tail (how it failed —
 * stack traces and assertion messages live at the bottom), and says explicitly
 * how much was dropped so a reader knows this is a fragment.
 */
function truncateMiddle(
  text: string,
  headChars: number,
  tailChars: number
): { content: string; truncated: boolean } {
  if (text.length <= headChars + tailChars) {
    return { content: text, truncated: false };
  }
  const dropped = text.length - headChars - tailChars;
  return {
    content:
      text.slice(0, headChars) +
      `\n\n… [${dropped} characters dropped at ingest — re-run the command if you need the full output] …\n\n` +
      text.slice(text.length - tailChars),
    truncated: true,
  };
}

/**
 * Split an over-long segment on natural boundaries.
 *
 * Prefers paragraph breaks, then line breaks, then a hard cut. Reasoning is
 * never dropped — only divided — because the sentence that explains why an
 * approach failed is as likely to be in the middle as at either end.
 */
function splitOversized(text: string): string[] {
  if (text.length <= MAX_SEGMENT_CHARS) return [text];

  const parts: string[] = [];
  let rest = text;

  while (rest.length > MAX_SEGMENT_CHARS) {
    const window = rest.slice(0, MAX_SEGMENT_CHARS);
    // Look for a break in the last third of the window so pieces stay big.
    const searchFrom = Math.floor(MAX_SEGMENT_CHARS * 0.66);
    let cut = window.lastIndexOf("\n\n");
    if (cut < searchFrom) cut = window.lastIndexOf("\n");
    if (cut < searchFrom) cut = MAX_SEGMENT_CHARS;

    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest.length > 0) parts.push(rest);
  return parts.filter((p) => p.length > 0);
}

// ─── Segment construction ───────────────────────────────────────────────────

function makeSegment(
  role: SegmentRole,
  kind: SegmentKind,
  rawContent: string,
  options: {
    toolName?: string | null;
    files?: string[];
    occurredAt?: string | null;
    truncated?: boolean;
  } = {}
): ParsedSegment {
  // Redact at parse time: a transcript is the densest concentration of
  // secrets in the system, and this is the last point before persistence.
  const content = redactString(rawContent).trim();
  return {
    role,
    kind,
    content,
    token_estimate: estimateTokens(content),
    tool_name: options.toolName ?? null,
    files: options.files ? redactFilePaths(options.files) : [],
    importance: KIND_IMPORTANCE[kind],
    truncated: options.truncated ?? false,
    occurred_at: options.occurredAt ?? null,
  };
}

/** Emit one logical piece as one or more segments, splitting if oversized. */
function pushSegment(
  out: ParsedSegment[],
  role: SegmentRole,
  kind: SegmentKind,
  rawContent: string,
  options: Parameters<typeof makeSegment>[3] = {}
): void {
  const trimmed = rawContent?.trim();
  if (!trimmed) return;

  for (const piece of splitOversized(trimmed)) {
    const segment = makeSegment(role, kind, piece, options);
    if (segment.content.length > 0) out.push(segment);
  }
}

/**
 * Merge runs of very short same-kind segments.
 *
 * Transcripts are full of one-line assistant asides between tool calls. Stored
 * separately they are noise that dilutes search; joined they often read as a
 * coherent thought. Tool results are never merged — two unrelated command
 * outputs glued together is worse than either alone.
 */
function coalesce(segments: ParsedSegment[]): ParsedSegment[] {
  const out: ParsedSegment[] = [];

  for (const segment of segments) {
    const previous = out[out.length - 1];
    const mergeable =
      previous &&
      previous.kind === segment.kind &&
      previous.role === segment.role &&
      segment.kind !== "tool_result" &&
      segment.kind !== "tool_call" &&
      segment.content.length < MIN_SEGMENT_CHARS &&
      previous.content.length + segment.content.length < MAX_SEGMENT_CHARS;

    if (mergeable) {
      previous.content = `${previous.content}\n${segment.content}`;
      previous.token_estimate = estimateTokens(previous.content);
      previous.truncated = previous.truncated || segment.truncated;
      continue;
    }
    out.push(segment);
  }

  return out;
}

// ─── Content-block handling ─────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Best-effort text extraction from an arbitrarily-shaped value. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");

  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) return textOf(record.content);
  return "";
}

function fileFromToolInput(input: Record<string, unknown> | null): string[] {
  if (!input) return [];
  const candidate =
    input.file_path ?? input.filePath ?? input.notebook_path ?? input.path;
  return typeof candidate === "string" ? [candidate] : [];
}

/** One-line description of a tool call: enough to know what it did. */
function describeToolCall(
  toolName: string,
  input: Record<string, unknown> | null
): string {
  if (!input) return toolName;

  if (typeof input.command === "string") {
    return `$ ${input.command}`;
  }
  const file = fileFromToolInput(input)[0];
  if (file) {
    const detail =
      typeof input.old_string === "string"
        ? " (edit)"
        : typeof input.content === "string"
          ? " (write)"
          : "";
    return `${toolName}: ${file}${detail}`;
  }
  if (typeof input.pattern === "string") {
    return `${toolName}: /${input.pattern}/`;
  }
  if (typeof input.description === "string") {
    return `${toolName}: ${input.description}`;
  }

  const json = JSON.stringify(input);
  return `${toolName}: ${json.slice(0, TOOL_CALL_CHARS)}`;
}

/**
 * Walk one message's content blocks into segments.
 *
 * Handles both the array-of-blocks shape and the plain-string shape, since
 * agent runtimes use both and older transcripts mix them.
 */
function segmentsFromMessage(
  out: ParsedSegment[],
  role: SegmentRole,
  content: unknown,
  occurredAt: string | null
): void {
  if (typeof content === "string") {
    pushSegment(out, role, role === "user" ? "prompt" : "reasoning", content, {
      occurredAt,
    });
    return;
  }

  if (!Array.isArray(content)) {
    const fallback = textOf(content);
    if (fallback) {
      pushSegment(out, role, role === "user" ? "prompt" : "reasoning", fallback, {
        occurredAt,
      });
    }
    return;
  }

  for (const rawBlock of content) {
    const block = asRecord(rawBlock);
    if (!block) {
      const loose = textOf(rawBlock);
      if (loose) {
        pushSegment(out, role, role === "user" ? "prompt" : "reasoning", loose, {
          occurredAt,
        });
      }
      continue;
    }

    const type = typeof block.type === "string" ? block.type : "";

    switch (type) {
      case "text": {
        pushSegment(
          out,
          role,
          role === "user" ? "prompt" : "reasoning",
          textOf(block),
          { occurredAt }
        );
        break;
      }

      case "thinking":
      case "redacted_thinking": {
        // Extended thinking is reasoning of the highest value: it is where an
        // approach gets rejected, and it is never restated in the final answer.
        const thinking =
          typeof block.thinking === "string" ? block.thinking : textOf(block);
        pushSegment(out, "assistant", "reasoning", thinking, { occurredAt });
        break;
      }

      case "tool_use": {
        const toolName = typeof block.name === "string" ? block.name : "tool";
        const input = asRecord(block.input);
        pushSegment(out, "assistant", "tool_call", describeToolCall(toolName, input), {
          toolName,
          files: fileFromToolInput(input),
          occurredAt,
        });
        break;
      }

      case "tool_result": {
        const raw = textOf(block.content ?? block);
        if (!raw.trim()) break;
        const { content: body, truncated } = truncateMiddle(
          raw,
          TOOL_RESULT_HEAD_CHARS,
          TOOL_RESULT_TAIL_CHARS
        );
        // An error result is worth as much as reasoning — it is the evidence
        // for why an approach was abandoned — so it is promoted out of the
        // noise floor rather than left at tool_result's default salience.
        const isError = block.is_error === true;
        const segment = makeSegment("tool", "tool_result", body, {
          occurredAt,
          truncated,
        });
        if (isError) segment.importance = 4;
        if (segment.content.length > 0) out.push(segment);
        break;
      }

      default: {
        const loose = textOf(block);
        if (loose) {
          pushSegment(out, role, role === "user" ? "prompt" : "reasoning", loose, {
            occurredAt,
          });
        }
      }
    }
  }
}

// ─── Format parsers ─────────────────────────────────────────────────────────

function normaliseRole(raw: unknown): SegmentRole {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  if (value === "user" || value === "human") return "user";
  if (value === "system") return "system";
  if (value === "tool") return "tool";
  return "assistant";
}

function timestampOf(record: Record<string, unknown>): string | null {
  const candidate = record.timestamp ?? record.created_at ?? record.time;
  if (typeof candidate === "string" && !Number.isNaN(Date.parse(candidate))) {
    return new Date(candidate).toISOString();
  }
  if (typeof candidate === "number") {
    // Seconds or milliseconds — anything below ~1e12 is seconds.
    const ms = candidate < 1e12 ? candidate * 1000 : candidate;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

/**
 * Parse a JSONL transcript.
 *
 * Covers Claude Code and Codex, which differ in envelope but agree on the part
 * that matters: one JSON object per line carrying a role and some content.
 * Rather than branch on format we probe each line for the shapes we know, which
 * keeps working when either tool reorganises its envelope.
 *
 * A trailing partial line — the normal case when shipping a file that is still
 * being appended to — is left unconsumed so the next send picks it up whole.
 */
/**
 * Envelope types that are harness bookkeeping, not conversation.
 *
 * Real Claude Code transcripts interleave the UI's own records with the
 * messages. `queue-operation` is the dangerous one: it carries the operator's
 * prompt text in a bare `content` field with no role, so the generic path read
 * it as assistant output. The transcript then attributed the human's
 * instructions to the agent, at high salience, duplicating every prompt. A
 * brief built from that tells the next agent it *decided* something a person
 * actually told it to do, which is the one class of error this product cannot
 * make. None of these carry anything the messages do not already hold.
 */
const HARNESS_ENVELOPE_TYPES = new Set([
  "attachment",
  "atis-latch",
  "file-history-snapshot",
  "last-prompt",
  "mode",
  "queue-operation",
]);

/** Envelope types that genuinely name a speaker rather than a record kind. */
const ROLE_WORDS = new Set([
  "user",
  "human",
  "assistant",
  "system",
  "tool",
  "message",
]);

/**
 * Render a compaction boundary as the thing it actually is: a hole.
 *
 * When a harness compacts, everything before the boundary stops being verbatim
 * and survives only as summary. That is the most valuable single fact in the
 * file for a successor — the difference between "I could not find it" and "it
 * is not there any more" — and the record states the exact size of the loss.
 * Stored as `summary`, so it carries the top importance and is the last thing
 * a budgeted brief drops.
 */
function compactionSummary(record: Record<string, unknown>): string {
  const label = textOf(record.content).trim() || "Conversation compacted";
  const meta = asRecord(record.compactMetadata);
  if (!meta) return label;

  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const trigger = typeof meta.trigger === "string" ? meta.trigger : null;
  const pre = num(meta.preTokens);
  const post = num(meta.postTokens);
  const dropped = num(meta.cumulativeDroppedTokens);

  const parts = [trigger ? `${label} (${trigger}).` : `${label}.`];
  if (pre !== null && post !== null) {
    parts.push(
      `Context went from ~${pre.toLocaleString("en-US")} to ` +
        `~${post.toLocaleString("en-US")} tokens.`
    );
  }
  if (dropped !== null && dropped > 0) {
    parts.push(
      `~${dropped.toLocaleString("en-US")} tokens of detail were dropped and ` +
        `are NOT recoverable from this transcript.`
    );
  }
  parts.push("Anything earlier survives only as summary.");
  return parts.join(" ");
}

function parseJsonl(text: string): ParseResult {
  const segments: ParsedSegment[] = [];
  let messageCount = 0;

  // Splitting always leaves a final element that is NOT a consumed line:
  // "a\nb\n" splits to ["a","b",""] and "a\nb" splits to ["a","b"]. In the
  // first case it is an empty string after the last newline; in the second it
  // is a half-written line we must leave for the next send. Dropping the last
  // element handles both. Counting it would push the resume offset past the
  // end and silently eat the first character of the following chunk.
  const completeLines = text.split("\n").slice(0, -1);

  let consumedBytes = 0;
  for (const line of completeLines) {
    consumedBytes += Buffer.byteLength(line, "utf8") + 1; // +1 for the newline

    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: Record<string, unknown> | null = null;
    try {
      record = asRecord(JSON.parse(trimmed));
    } catch {
      // A malformed line is skipped, not fatal. Transcripts get truncated by
      // crashes, and one bad line must not cost us the other 4,000.
      continue;
    }
    if (!record) continue;

    const envelopeType = typeof record.type === "string" ? record.type : "";

    // Checked before anything looks for content: several of these carry a bare
    // `content` string with no role, which is exactly what fooled the reader.
    if (HARNESS_ENVELOPE_TYPES.has(envelopeType)) continue;

    // Claude Code nests the payload under `message`; Codex and others put the
    // role and content at the top level.
    const message = asRecord(record.message) ?? record;

    // A compaction boundary marks context that no longer exists verbatim.
    if (envelopeType === "system" && record.subtype === "compact_boundary") {
      messageCount += 1;
      pushSegment(segments, "system", "summary", compactionSummary(record), {
        occurredAt: timestampOf(record),
      });
      continue;
    }

    // Compaction summaries are the distilled memory the agent chose to keep.
    if (envelopeType === "summary") {
      const summary = textOf(record.summary ?? record.content ?? message);
      if (summary) {
        messageCount += 1;
        pushSegment(segments, "system", "summary", summary, {
          occurredAt: timestampOf(record),
        });
      }
      continue;
    }

    const content = message.content ?? record.content;
    if (content === undefined || content === null) continue;

    // An unrecognised envelope type is a harness record, not a message.
    // Defaulting it to `assistant` is how the operator's own words ended up
    // filed as agent reasoning, so an unresolvable role is skipped instead.
    // A record with no type at all still falls through to the old behaviour,
    // which is what keeps the generic "any harness" path working.
    const rawRole = message.role ?? record.role ?? null;
    if (
      rawRole === null &&
      envelopeType !== "" &&
      !ROLE_WORDS.has(envelopeType.toLowerCase())
    ) {
      continue;
    }

    const role = normaliseRole(rawRole ?? envelopeType);
    const occurredAt = timestampOf(record) ?? timestampOf(message);

    messageCount += 1;
    segmentsFromMessage(segments, role, content, occurredAt);
  }

  return {
    segments: coalesce(segments),
    messageCount,
    consumedBytes,
  };
}

/**
 * Parse an unstructured transcript.
 *
 * The fallback for anything we cannot recognise: split on blank lines and store
 * the pieces as reasoning. Crude, but a searchable crude transcript is worth
 * far more than a rejected one, and this is what makes "any agent, any
 * harness" a real claim rather than a marketing one.
 */
function parsePlain(text: string): ParseResult {
  const segments: ParsedSegment[] = [];
  const blocks = text.split(/\n{2,}/);

  for (const block of blocks) {
    pushSegment(segments, "assistant", "reasoning", block, {});
  }

  return {
    segments: coalesce(segments),
    messageCount: blocks.filter((b) => b.trim().length > 0).length,
    consumedBytes: Buffer.byteLength(text, "utf8"),
  };
}

/**
 * Parse a transcript chunk into segments.
 *
 * `format` is a hint. JSONL content is detected regardless, because clients
 * mislabel and a transcript parsed as plain text loses all its structure.
 */
export function parseTranscript(
  text: string,
  format: TranscriptFormat = "plain"
): ParseResult {
  if (!text || text.trim().length === 0) {
    return { segments: [], messageCount: 0, consumedBytes: 0 };
  }

  const looksJsonl =
    format === "claude_code_jsonl" ||
    format === "codex_jsonl" ||
    /^\s*\{/.test(text);

  try {
    return looksJsonl ? parseJsonl(text) : parsePlain(text);
  } catch {
    // Belt and braces: never let a parser bug cost the caller its transcript.
    return parsePlain(text);
  }
}

/** Sum of segment token estimates, for the transcript-level counter. */
export function totalTokens(segments: readonly ParsedSegment[]): number {
  return segments.reduce((sum, s) => sum + s.token_estimate, 0);
}
