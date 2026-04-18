import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";

/**
 * Unit tests for the concurrent-edit warning primitives.
 *
 * We deliberately exercise the pure helpers `shouldBroadcast` and
 * `createWarningAutoDismiss` rather than the full React hook because
 * the vitest environment in this repo is `node` (see vitest.config.ts)
 * and pulling in a renderer just for these tests would violate the
 * "no new deps" constraint. The hook itself composes these two
 * helpers directly, so covering them covers the user-visible
 * behaviour described in V3 quick win #4.
 *
 * Invariants under test:
 *
 *   1. Two edits within 3s at the same line → only the first
 *      broadcast fires.
 *   2. An edit at line 1 followed by an edit at line 10 within 3s →
 *      both broadcasts fire (line delta > 5).
 *   3. An edit at line 1 followed 3s later by an edit at line 2 →
 *      both broadcasts fire (time window elapsed).
 *   4. A warning arriving via `arrive()` auto-dismisses after 10s.
 *   5. A fresh `arrive()` within the 10s window resets the timer.
 *   6. Manual `dismiss()` clears the warning and cancels the timer.
 *   7. `destroy()` cancels the timer without emitting a state change.
 */

import {
  BROADCAST_LINE_DELTA,
  BROADCAST_MIN_INTERVAL_MS,
  CONCURRENT_WARNING_TTL_MS,
  createWarningAutoDismiss,
  shouldBroadcast,
  type WarningState,
} from "@/lib/hooks/use_concurrent_edit_warning";

describe("shouldBroadcast", () => {
  it("always broadcasts when no previous broadcast is recorded", () => {
    expect(shouldBroadcast(null, null, 0, 1)).toBe(true);
    expect(shouldBroadcast(null, null, 1_000_000, 42)).toBe(true);
  });

  it("suppresses a second edit within 3s at the same line", () => {
    // First broadcast happened at t=0 on line 1; another edit fires
    // 1.5s later still on line 1 — should be suppressed.
    const lastTime = 0;
    const lastLine = 1;
    const now = 1_500;
    expect(shouldBroadcast(lastTime, lastLine, now, 1)).toBe(false);
  });

  it("suppresses within 3s when line delta is <= threshold", () => {
    // Move 5 lines exactly — threshold is strictly greater-than, so
    // still suppressed.
    expect(shouldBroadcast(0, 1, 1_000, 6)).toBe(false);
    // Move 3 lines — clearly within threshold.
    expect(shouldBroadcast(0, 1, 1_000, 4)).toBe(false);
  });

  it("broadcasts within 3s when line delta exceeds 5", () => {
    // Edit at line 1, then edit at line 10 (delta = 9 > 5) within 3s
    // — second broadcast should fire.
    expect(shouldBroadcast(0, 1, 1_000, 10)).toBe(true);
    // Jump upward (negative delta) is treated symmetrically.
    expect(shouldBroadcast(0, 50, 500, 40)).toBe(true);
  });

  it("broadcasts once the time window has elapsed even for the same line", () => {
    // Edit at line 1, wait exactly 3s, edit at line 2 — both fire.
    expect(
      shouldBroadcast(0, 1, BROADCAST_MIN_INTERVAL_MS, 2)
    ).toBe(true);
    // Slight overshoot still fires.
    expect(
      shouldBroadcast(0, 1, BROADCAST_MIN_INTERVAL_MS + 50, 2)
    ).toBe(true);
    // Just under the window — still suppressed.
    expect(
      shouldBroadcast(0, 1, BROADCAST_MIN_INTERVAL_MS - 1, 2)
    ).toBe(false);
  });

  it("honours custom timeWindowMs and lineThreshold overrides", () => {
    // With a 1s window and threshold of 0, any line change fires.
    expect(
      shouldBroadcast(0, 5, 100, 6, { timeWindowMs: 1_000, lineThreshold: 0 })
    ).toBe(true);
    // Same knobs, same line, within window → suppressed.
    expect(
      shouldBroadcast(0, 5, 100, 5, { timeWindowMs: 1_000, lineThreshold: 0 })
    ).toBe(false);
  });

  it("exports the tuned constants (3s / 5 lines) the editor relies on", () => {
    expect(BROADCAST_MIN_INTERVAL_MS).toBe(3_000);
    expect(BROADCAST_LINE_DELTA).toBe(5);
  });
});

describe("createWarningAutoDismiss", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-clears the warning after the TTL (10s) elapses", () => {
    const states: WarningState[] = [];
    const scheduler = createWarningAutoDismiss((s) => states.push(s));

    scheduler.arrive("Alice");
    expect(states.at(-1)).toEqual({ showWarning: true, savedBy: "Alice" });

    // Just before the TTL — still visible.
    vi.advanceTimersByTime(CONCURRENT_WARNING_TTL_MS - 1);
    expect(states.at(-1)).toEqual({ showWarning: true, savedBy: "Alice" });

    // Cross the 10s mark — auto-dismiss fires.
    vi.advanceTimersByTime(1);
    expect(states.at(-1)).toEqual({
      showWarning: false,
      savedBy: undefined,
    });
    expect(scheduler.hasPendingTimer()).toBe(false);
  });

  it("resets the timer when a second warning arrives within the window", () => {
    const states: WarningState[] = [];
    const scheduler = createWarningAutoDismiss((s) => states.push(s));

    scheduler.arrive("Alice");
    vi.advanceTimersByTime(9_000);
    // Second collaborator saves 9s after the first — banner should
    // show *Bob* and stay visible for a fresh 10s window.
    scheduler.arrive("Bob");
    expect(states.at(-1)).toEqual({ showWarning: true, savedBy: "Bob" });

    // 9s after the first arrive (= 0s after the reset) — still up.
    vi.advanceTimersByTime(5_000);
    expect(states.at(-1)).toEqual({ showWarning: true, savedBy: "Bob" });

    // Cross 10s from the reset point — now dismissed.
    vi.advanceTimersByTime(5_001);
    expect(states.at(-1)).toEqual({
      showWarning: false,
      savedBy: undefined,
    });
  });

  it("manual dismiss cancels the pending timer", () => {
    const states: WarningState[] = [];
    const scheduler = createWarningAutoDismiss((s) => states.push(s));

    scheduler.arrive("Alice");
    expect(scheduler.hasPendingTimer()).toBe(true);

    scheduler.dismiss();
    expect(states.at(-1)).toEqual({
      showWarning: false,
      savedBy: undefined,
    });
    expect(scheduler.hasPendingTimer()).toBe(false);

    // Advance well past the TTL — no new state changes should arrive.
    const countBefore = states.length;
    vi.advanceTimersByTime(CONCURRENT_WARNING_TTL_MS * 2);
    expect(states.length).toBe(countBefore);
  });

  it("destroy cancels the timer without emitting an additional state", () => {
    const states: WarningState[] = [];
    const scheduler = createWarningAutoDismiss((s) => states.push(s));

    scheduler.arrive("Alice");
    const countBeforeDestroy = states.length;

    scheduler.destroy();
    // destroy() deliberately does not push a cleared state — the
    // unmount path on a React hook would unmount the component before
    // any such update could render, so emitting one would be noise.
    expect(states.length).toBe(countBeforeDestroy);

    vi.advanceTimersByTime(CONCURRENT_WARNING_TTL_MS * 2);
    expect(states.length).toBe(countBeforeDestroy);
  });

  it("ignores further arrive() calls after destroy", () => {
    const states: WarningState[] = [];
    const scheduler = createWarningAutoDismiss((s) => states.push(s));
    scheduler.destroy();

    scheduler.arrive("Alice");
    expect(states.length).toBe(0);
    expect(scheduler.hasPendingTimer()).toBe(false);
  });

  it("accepts a custom ttlMs override", () => {
    const states: WarningState[] = [];
    const scheduler = createWarningAutoDismiss((s) => states.push(s), 500);

    scheduler.arrive("Alice");
    vi.advanceTimersByTime(499);
    expect(states.at(-1)?.showWarning).toBe(true);

    vi.advanceTimersByTime(1);
    expect(states.at(-1)?.showWarning).toBe(false);
  });
});
