import { describe, it, expect } from "vitest";

/**
 * Unit tests for transcript parsing and segmentation.
 *
 * This is where the product's central storage opinion is enforced:
 *
 *   PRESERVE WHAT CANNOT BE RECONSTRUCTED. DROP WHAT CAN.
 *
 * So the tests that matter are not "does it parse JSON" — they are:
 *   1. Is assistant reasoning kept whole, never truncated?
 *   2. Is bulk tool output cut down, keeping the head and the tail?
 *   3. Does an error result get promoted out of the noise floor?
 *   4. Does a partially-written trailing line stay unconsumed, so incremental
 *      shipping resumes at a line boundary instead of eating half a message?
 *   5. Does one malformed line cost us only that line?
 *
 * Point 4 is the one that would silently corrupt a live transcript, and it is
 * the normal case: we ship a file that the agent is still writing to.
 */

import {
  parseTranscript,
  totalTokens,
  type ParsedSegment,
} from "@/server/services/transcript_parser";

/** Build one Claude-Code-shaped JSONL line. */
function line(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

function assistantText(text: string, timestamp = "2026-09-09T09:00:00.000Z") {
  return line({
    type: "assistant",
    timestamp,
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

function userText(text: string, timestamp = "2026-09-09T09:00:00.000Z") {
  return line({
    type: "user",
    timestamp,
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function kinds(segments: ParsedSegment[]): string[] {
  return segments.map((s) => s.kind);
}

describe("parseTranscript — Claude Code JSONL", () => {
  it("separates a prompt from the reasoning that answers it", () => {
    const transcript =
      userText("Make charge creation idempotent") +
      assistantText("I'll key on (merchant_id, request_id) rather than a body hash.");

    const { segments, messageCount } = parseTranscript(
      transcript,
      "claude_code_jsonl"
    );

    expect(messageCount).toBe(2);
    expect(kinds(segments)).toEqual(["prompt", "reasoning"]);
    expect(segments[0].role).toBe("user");
    expect(segments[1].content).toContain("merchant_id");
  });

  it("keeps assistant reasoning whole — it is the irrecoverable part", () => {
    // Long, but under the split threshold: it must survive byte for byte.
    const reasoning =
      "I tried asserting the replay in the Stripe integration test. " +
      "It fails because test mode dedupes identical idempotency keys within 60 seconds, " +
      "so the second call never reaches our handler and the assertion is vacuous. ".repeat(8);

    const { segments } = parseTranscript(assistantText(reasoning), "claude_code_jsonl");

    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("reasoning");
    expect(segments[0].truncated).toBe(false);
    expect(segments[0].content).toContain("dedupes identical idempotency keys");
    expect(segments[0].content).toContain("the assertion is vacuous");
  });

  it("captures extended thinking as reasoning", () => {
    // Thinking is where approaches get rejected, and the rejection is never
    // restated in the visible answer.
    const transcript = line({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Optimistic locking avoids the table lock here." },
          {
            type: "text",
            text: "Using optimistic locking on the version column so concurrent charges do not serialise.",
          },
        ],
      },
    });

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");

    expect(segments.map((s) => s.content)).toContain(
      "Optimistic locking avoids the table lock here."
    );
    expect(segments.every((s) => s.kind === "reasoning")).toBe(true);
  });

  it("truncates bulk tool output, keeping the head and the tail", () => {
    // The useful parts of a failure are the start and the error at the end.
    const body =
      "START-OF-OUTPUT\n" + "filler line\n".repeat(4000) + "END: assertion failed";

    const transcript = line({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: body }],
      },
    });

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");
    const result = segments.find((s) => s.kind === "tool_result");

    expect(result).toBeDefined();
    expect(result!.truncated).toBe(true);
    expect(result!.content).toContain("START-OF-OUTPUT");
    expect(result!.content).toContain("END: assertion failed");
    expect(result!.content).toContain("characters dropped at ingest");
    expect(result!.content.length).toBeLessThan(body.length / 4);
  });

  it("ranks reasoning above tool output for retrieval", () => {
    const transcript =
      assistantText("The deadlock comes from taking the locks in the opposite order.") +
      line({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", content: "total 8\ndrwxr-xr-x  2 dev dev" }],
        },
      });

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");
    const reasoning = segments.find((s) => s.kind === "reasoning")!;
    const toolResult = segments.find((s) => s.kind === "tool_result")!;

    expect(reasoning.importance).toBeGreaterThan(toolResult.importance);
  });

  it("promotes a failing tool result — it is the evidence for a dead end", () => {
    const transcript = line({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", is_error: true, content: "ECONNREFUSED 127.0.0.1:5432" },
        ],
      },
    });

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");

    expect(segments[0].kind).toBe("tool_result");
    expect(segments[0].importance).toBe(4);
  });

  it("records tool calls with their target file", () => {
    const transcript = line({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: "/home/dev/app/src/charges/create.ts", old_string: "x" },
          },
        ],
      },
    });

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");

    expect(segments[0].kind).toBe("tool_call");
    expect(segments[0].tool_name).toBe("Edit");
    // The home directory is stripped: it identifies a person and a machine.
    expect(segments[0].files).toEqual(["~/app/src/charges/create.ts"]);
    expect(segments[0].content).toContain("(edit)");
  });

  it("renders a bash tool call as the command that ran", () => {
    const transcript = line({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Bash", input: { command: "pnpm test --filter charges" } },
        ],
      },
    });

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");
    expect(segments[0].content).toBe("$ pnpm test --filter charges");
  });

  it("keeps a compaction summary — it is what the agent chose to remember", () => {
    const transcript = line({
      type: "summary",
      summary: "Working on idempotent charges; retry middleware half-written.",
    });

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");

    expect(segments[0].kind).toBe("summary");
    expect(segments[0].importance).toBe(5);
  });
});

describe("parseTranscript — incremental shipping", () => {
  it("leaves a partially-written trailing line unconsumed", () => {
    // The normal case: we ship a file the agent is still appending to. Consuming
    // half a JSON object would corrupt the resume offset and lose the message.
    const complete = assistantText("First complete message");
    const partial = '{"type":"assistant","message":{"role":"assist';

    const { segments, consumedBytes } = parseTranscript(
      complete + partial,
      "claude_code_jsonl"
    );

    expect(segments).toHaveLength(1);
    expect(consumedBytes).toBe(Buffer.byteLength(complete, "utf8"));
    // Resuming from consumedBytes replays the partial line in full next time.
    expect(consumedBytes).toBeLessThan(
      Buffer.byteLength(complete + partial, "utf8")
    );
  });

  it("consumes every byte when the chunk ends on a line boundary", () => {
    const transcript =
      assistantText("The first message, long enough to stand alone as a segment.") +
      assistantText("The second message, also long enough to stand alone.");
    const { consumedBytes, segments } = parseTranscript(
      transcript,
      "claude_code_jsonl"
    );

    expect(consumedBytes).toBe(Buffer.byteLength(transcript, "utf8"));
    expect(segments).toHaveLength(2);
  });

  it("counts bytes, not characters, so multi-byte text resumes correctly", () => {
    // An offset computed in characters would drift on any non-ASCII transcript
    // and silently re-ingest or skip content.
    const transcript = assistantText("café — naïve — 日本語");
    const { consumedBytes } = parseTranscript(transcript, "claude_code_jsonl");

    expect(consumedBytes).toBe(Buffer.byteLength(transcript, "utf8"));
    expect(consumedBytes).toBeGreaterThan(transcript.length);
  });
});

describe("parseTranscript — robustness", () => {
  it("skips a malformed line without losing the rest", () => {
    const before = "The first message, long enough to stand as its own segment.";
    const after = "The message after the corruption, also its own segment entirely.";
    const transcript =
      assistantText(before) + "{not json at all\n" + assistantText(after);

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");

    expect(segments.map((s) => s.content)).toEqual([before, after]);
  });

  it("handles a plain-string content field", () => {
    const transcript = line({
      type: "assistant",
      message: { role: "assistant", content: "Just a string, not blocks" },
    });

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");
    expect(segments[0].content).toBe("Just a string, not blocks");
  });

  it("degrades unknown formats to searchable text rather than rejecting them", () => {
    const transcript =
      "Some notes about the work that ran long enough to be its own segment.\n\n" +
      "A second paragraph, likewise long enough that it is not merged away.";
    const { segments } = parseTranscript(transcript, "plain");

    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.kind === "reasoning")).toBe(true);
  });

  it("returns empty for empty input instead of throwing", () => {
    expect(parseTranscript("", "claude_code_jsonl").segments).toEqual([]);
    expect(parseTranscript("   \n  ", "plain").segments).toEqual([]);
  });

  it("redacts credentials before they are ever persisted", () => {
    // A transcript is the densest concentration of secrets in the system, and
    // parse time is the last point before storage.
    const transcript = line({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz012345" },
          },
        ],
      },
    });

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");
    expect(segments[0].content).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz012345");
  });
});

describe("parseTranscript — segmentation shape", () => {
  it("splits an oversized block instead of dropping or storing it whole", () => {
    const huge = ("A detailed paragraph about the retry design.\n\n").repeat(400);
    const { segments } = parseTranscript(assistantText(huge), "claude_code_jsonl");

    expect(segments.length).toBeGreaterThan(1);
    // Every piece stays within the per-segment ceiling.
    for (const segment of segments) {
      expect(segment.content.length).toBeLessThanOrEqual(6000);
    }
    // And nothing was thrown away: the pieces still carry the whole text.
    const rejoined = segments.map((s) => s.content).join("");
    expect(rejoined).toContain("retry design");
    expect(rejoined.length).toBeGreaterThan(huge.length * 0.9);
  });

  it("merges one-line asides but never merges two tool results", () => {
    const transcript =
      assistantText("ok") +
      assistantText("now the test") +
      line({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", content: "pass" }] },
      }) +
      line({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", content: "fail" }] },
      });

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");
    const reasoning = segments.filter((s) => s.kind === "reasoning");
    const results = segments.filter((s) => s.kind === "tool_result");

    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].content).toBe("ok\nnow the test");
    // Gluing unrelated command output together is worse than either alone.
    expect(results).toHaveLength(2);
  });

  it("totals token estimates across segments", () => {
    const { segments } = parseTranscript(
      assistantText("a".repeat(400)) + assistantText("b".repeat(400)),
      "claude_code_jsonl"
    );
    expect(totalTokens(segments)).toBe(200);
  });
});

/**
 * Regression tests written against the shapes in a real Claude Code transcript
 * (a 5.7MB, 2,000-line JSONL from an actual multi-hour session), not against
 * what the format was assumed to look like. Every case here corresponds to
 * something the parser got wrong on real data.
 */
describe("real Claude Code envelope shapes", () => {
  /** Verbatim shapes, with the conversation content replaced. */
  const QUEUE_OP = JSON.stringify({
    type: "queue-operation",
    operation: "enqueue",
    timestamp: "2026-09-08T23:14:05.451Z",
    sessionId: "de3233a3",
    content: "Ship the migration before Friday",
  });
  const LAST_PROMPT = JSON.stringify({
    type: "last-prompt",
    lastPrompt: "Ship the migration before Friday",
    leafUuid: "99e33c07",
    sessionId: "de3233a3",
  });
  const MODE = JSON.stringify({ type: "mode", mode: "normal", sessionId: "x" });
  const LATCH = JSON.stringify({ type: "atis-latch", atis: "", sessionId: "x" });
  const ATTACHMENT = JSON.stringify({
    type: "attachment",
    attachment: { type: "environment", snapshot: { workingDirectory: "/repo" } },
  });

  it("never files the operator's own prompt as agent reasoning", () => {
    // `queue-operation` carries the human's prompt in a bare `content` field
    // with no role. Reading it as assistant output made the transcript claim
    // the agent reasoned its way to an instruction it was given — a confident
    // lie about who decided what, which is the worst thing this can store.
    const { segments } = parseTranscript(
      `${QUEUE_OP}\n${LAST_PROMPT}\n`,
      "claude_code_jsonl"
    );
    expect(segments).toHaveLength(0);
    expect(
      segments.filter((s) => s.content.includes("Ship the migration"))
    ).toHaveLength(0);
  });

  it("drops harness bookkeeping without dropping the messages around it", () => {
    const transcript = [
      MODE,
      LATCH,
      ATTACHMENT,
      JSON.stringify({
        type: "user",
        timestamp: "2026-09-09T04:05:50.002Z",
        message: { role: "user", content: "Ship the migration before Friday" },
      }),
      QUEUE_OP,
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-09-09T04:06:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "x".repeat(120) }],
        },
      }),
      "",
    ].join("\n");

    const { segments } = parseTranscript(transcript, "claude_code_jsonl");
    expect(segments.map((s) => `${s.role}:${s.kind}`)).toEqual([
      "user:prompt",
      "assistant:reasoning",
    ]);
  });

  it("records a compaction boundary as a top-importance hole", () => {
    // The single most valuable record in the file for a successor agent: it is
    // the difference between "I could not find it" and "it is not there".
    const boundary = JSON.stringify({
      type: "system",
      subtype: "compact_boundary",
      timestamp: "2026-09-09T09:00:00.000Z",
      content: "Conversation compacted",
      compactMetadata: {
        trigger: "auto",
        preTokens: 791856,
        postTokens: 15284,
        cumulativeDroppedTokens: 776572,
      },
    });

    const { segments } = parseTranscript(`${boundary}\n`, "claude_code_jsonl");
    expect(segments).toHaveLength(1);

    const [segment] = segments;
    expect(segment.kind).toBe("summary");
    expect(segment.role).toBe("system");
    // Salience 5: a budgeted brief must drop this last, not first.
    expect(segment.importance).toBe(5);
    expect(segment.occurred_at).toBe("2026-09-09T09:00:00.000Z");
    // The size of the loss is the point — an unquantified "compacted" tells
    // the reader nothing about whether to go looking for the detail.
    expect(segment.content).toContain("776,572");
    expect(segment.content).toContain("NOT recoverable");
  });

  it("survives a compaction boundary with no metadata", () => {
    const bare = JSON.stringify({
      type: "system",
      subtype: "compact_boundary",
      content: "Conversation compacted",
    });
    const { segments } = parseTranscript(`${bare}\n`, "claude_code_jsonl");
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("summary");
    expect(segments[0].content).toBe("Conversation compacted");
  });

  it("ignores a system record that carries no content", () => {
    const hook = JSON.stringify({
      type: "system",
      subtype: "stop_hook_summary",
      level: "info",
    });
    expect(parseTranscript(`${hook}\n`, "claude_code_jsonl").segments).toEqual(
      []
    );
  });

  it("still accepts role-bearing records from harnesses we do not know", () => {
    // The denylist must not become an allowlist: "any agent, any harness" is a
    // real claim, so an unfamiliar envelope that names its speaker is kept.
    const codex = JSON.stringify({
      type: "message",
      role: "assistant",
      content: "y".repeat(120),
    });
    const roleless = JSON.stringify({ content: "z".repeat(120) });

    expect(
      parseTranscript(`${codex}\n`, "claude_code_jsonl").segments[0]?.role
    ).toBe("assistant");
    expect(
      parseTranscript(`${roleless}\n`, "claude_code_jsonl").segments
    ).toHaveLength(1);
  });
});
