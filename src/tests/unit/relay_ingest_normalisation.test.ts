import { describe, it, expect } from "vitest";

/**
 * Unit tests for relay ingest normalisation.
 *
 * These cover the boundary where untrusted, badly-behaved client input meets
 * the database. Hooks are written by us but installed everywhere, run in
 * versions we do not control, and are joined by curl one-liners and custom
 * integrations. The governing rule is: coerce, do not reject. A partial log
 * beats no log, so almost nothing here is allowed to be fatal.
 *
 * The exception is identity — a project we cannot name and a session with no
 * external id are not recoverable by guessing, so those do throw.
 */

import { toProjectSlug } from "@/server/repositories/project_repository";
import { normaliseEndReason } from "@/server/services/session_ingest_service";
import { redactString } from "@/server/services/session_event_redaction";
import {
  DEFAULT_EVENT_IMPORTANCE,
  SESSION_EVENT_TYPES,
  UNFINISHED_END_REASONS,
} from "@/server/domain/constants/agent_session_constants";

describe("toProjectSlug", () => {
  it("derives one stable slug from every way of naming the same repo", () => {
    // A laptop clone, a CI checkout, and a hand-typed name must land on one
    // project, or the relay silently splits a team's history in half.
    const expected = "acme-checkout-service";
    expect(toProjectSlug("git@github.com:acme/checkout-service.git")).toBe(expected);
    expect(toProjectSlug("https://github.com/acme/checkout-service")).toBe(expected);
    expect(toProjectSlug("https://github.com/acme/checkout-service.git")).toBe(expected);
    expect(toProjectSlug("acme/checkout-service")).toBe(expected);
  });

  it("lowercases and collapses characters the slug constraint rejects", () => {
    expect(toProjectSlug("My Project!!")).toBe("my-project");
    expect(toProjectSlug("a  b   c")).toBe("a-b-c");
  });

  it("produces a slug that satisfies the database CHECK constraint", () => {
    const constraint = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/;
    for (const input of [
      "git@github.com:acme/checkout-service.git",
      "---leading-and-trailing---",
      "UPPER_CASE_NAME",
      "x",
      "a.b.c",
    ]) {
      const slug = toProjectSlug(input);
      expect(slug, `input: ${input}`).not.toBeNull();
      expect(slug!, `input: ${input}`).toMatch(constraint);
    }
  });

  it("returns null when nothing usable survives, rather than inventing a name", () => {
    // Silently bucketing unnameable input into a default project would mix
    // two teams' logs together, which is worse than a 400.
    expect(toProjectSlug("")).toBeNull();
    expect(toProjectSlug("!!!")).toBeNull();
    expect(toProjectSlug("   ")).toBeNull();
  });
});

describe("normaliseEndReason", () => {
  it("accepts the canonical reasons", () => {
    expect(normaliseEndReason("usage_capped")).toBe("usage_capped");
    expect(normaliseEndReason("completed")).toBe("completed");
  });

  it("accepts the spellings a hook is likely to send", () => {
    expect(normaliseEndReason("usage-capped")).toBe("usage_capped");
    expect(normaliseEndReason("Usage Capped")).toBe("usage_capped");
  });

  it("degrades an unrecognised reason to 'unknown' instead of guessing", () => {
    // Guessing 'completed' here would be the worst possible default: it would
    // tell the next agent the work was finished when it may not have been.
    expect(normaliseEndReason("ran out of tokens lol")).toBe("unknown");
    expect(normaliseEndReason(undefined)).toBe("unknown");
    expect(normaliseEndReason("")).toBe("unknown");
  });
});

describe("event salience defaults", () => {
  it("assigns a default importance to every event type", () => {
    for (const type of SESSION_EVENT_TYPES) {
      expect(DEFAULT_EVENT_IMPORTANCE[type], `missing default for ${type}`).toBeTypeOf(
        "number"
      );
      expect(DEFAULT_EVENT_IMPORTANCE[type]).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_EVENT_IMPORTANCE[type]).toBeLessThanOrEqual(5);
    }
  });

  it("ranks what a handoff needs above what it does not", () => {
    // The whole brief ordering rests on these relative values.
    expect(DEFAULT_EVENT_IMPORTANCE.decision).toBeGreaterThan(
      DEFAULT_EVENT_IMPORTANCE.file_edit
    );
    expect(DEFAULT_EVENT_IMPORTANCE.blocker).toBeGreaterThan(
      DEFAULT_EVENT_IMPORTANCE.command
    );
    expect(DEFAULT_EVENT_IMPORTANCE.usage_limit).toBe(5);
    expect(DEFAULT_EVENT_IMPORTANCE.file_read).toBe(0);
  });

  it("treats a cap, a context exhaustion, and a crash as unfinished work", () => {
    expect(UNFINISHED_END_REASONS).toContain("usage_capped");
    expect(UNFINISHED_END_REASONS).toContain("context_exhausted");
    expect(UNFINISHED_END_REASONS).toContain("crashed");
    expect(UNFINISHED_END_REASONS).not.toContain("completed");
  });
});

describe("summary redaction at ingest", () => {
  it("scrubs a credential a hook put in an event summary", () => {
    // The summary is the field that lands in a brief and is read by the next
    // agent, so it gets the same treatment as the payload.
    const summary = "Bash: curl -H 'Authorization: Bearer sk-ant-abcdefghijklmnopqrst'";
    const out = redactString(summary);
    expect(out).not.toContain("sk-ant-abcdefghijklmnopqrst");
  });
});
