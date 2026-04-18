"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/browser";

/**
 * How long a concurrent-edit warning stays on screen before we auto-
 * clear it. Kept at 10s so the user has time to notice while not
 * permanently obscuring the editor chrome if they didn't click away.
 */
export const CONCURRENT_WARNING_TTL_MS = 10_000;

/**
 * Minimum gap between edit broadcasts on the `note_edits:${noteId}`
 * channel when the caller isn't moving much. Together with
 * BROADCAST_LINE_DELTA this forms a cheap throttle that lets a fast
 * typist spam 40 keystrokes a second without flooding Realtime.
 */
export const BROADCAST_MIN_INTERVAL_MS = 3_000;

/**
 * Line-delta that forces an immediate broadcast even within the
 * interval window — if the user hops from line 1 to line 200 we want
 * collaborators to see that right away, not three seconds later.
 */
export const BROADCAST_LINE_DELTA = 5;

interface ConcurrentEditWarning {
  /** True when another user has saved changes since we started editing. */
  showWarning: boolean;
  /** Display name of the user who last saved, if available. */
  savedBy?: string;
  /** Broadcast a save event so other editors know we saved. Always
   *  flushes immediately — saves are a deliberate signal collaborators
   *  must see. */
  broadcastSave: (userId: string, displayName: string, versionId: string) => void;
  /** Broadcast an edit-in-progress event. Throttled — only fires when
   *  BROADCAST_MIN_INTERVAL_MS has elapsed since the last broadcast for
   *  this note, OR the caller has moved more than BROADCAST_LINE_DELTA
   *  lines away from the last broadcast line. Returns true iff a
   *  broadcast was actually sent. */
  broadcastEdit: (userId: string, displayName: string, line: number) => boolean;
  /** Dismiss the warning manually (e.g. after user clicks dismiss). */
  dismiss: () => void;
}

/**
 * Represents the warning banner's external state. Extracted as a type
 * so the `createWarningAutoDismiss` scheduler can be tested without
 * spinning up React.
 */
export interface WarningState {
  showWarning: boolean;
  savedBy?: string;
}

/**
 * Tiny state machine that mirrors what `useConcurrentEditWarning`
 * does in-React: each `arrive(name)` call sets the warning to visible
 * and schedules a timeout `ttlMs` later that clears it. Calling
 * `arrive` again before the timeout fires resets the timer. The
 * timeout is cleared on `dismiss()` and `destroy()`.
 *
 * We extract it so the auto-dismiss behaviour is testable with plain
 * fake timers instead of a React renderer (this repo's vitest env is
 * `node` — no jsdom).
 */
export function createWarningAutoDismiss(
  onChange: (state: WarningState) => void,
  ttlMs: number = CONCURRENT_WARNING_TTL_MS
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    arrive(savedBy: string) {
      if (destroyed) return;
      clearTimer();
      onChange({ showWarning: true, savedBy });
      timer = setTimeout(() => {
        timer = null;
        if (destroyed) return;
        onChange({ showWarning: false, savedBy: undefined });
      }, ttlMs);
    },
    dismiss() {
      clearTimer();
      if (destroyed) return;
      onChange({ showWarning: false, savedBy: undefined });
    },
    destroy() {
      destroyed = true;
      clearTimer();
    },
    hasPendingTimer(): boolean {
      return timer !== null;
    },
  };
}

/**
 * Pure throttle decision used by the editor-broadcast path. Exposed
 * as a named export so the debounce logic is unit-testable without
 * spinning up a React renderer.
 *
 * Returns true when the caller should send a broadcast given the
 * previous broadcast's timestamp + line and the current call's
 * timestamp + line. The rule is:
 *
 *   – No previous broadcast (time is null) → always broadcast.
 *   – Caller jumped more than `lineThreshold` lines → broadcast.
 *   – `timeWindowMs` has elapsed since the last broadcast → broadcast.
 *   – Otherwise → skip.
 */
export function shouldBroadcast(
  lastTime: number | null,
  lastLine: number | null,
  now: number,
  currentLine: number,
  opts: { timeWindowMs?: number; lineThreshold?: number } = {}
): boolean {
  const timeWindowMs = opts.timeWindowMs ?? BROADCAST_MIN_INTERVAL_MS;
  const lineThreshold = opts.lineThreshold ?? BROADCAST_LINE_DELTA;
  if (lastTime == null) return true;
  if (
    lastLine != null &&
    Math.abs(currentLine - lastLine) > lineThreshold
  ) {
    return true;
  }
  return now - lastTime >= timeWindowMs;
}

/**
 * Subscribes to the `note_edits:${noteId}` Supabase Realtime broadcast
 * channel. When another user saves (broadcasts `{ type: 'saved', ... }`),
 * the hook sets `showWarning = true` with the saver's display name and
 * schedules an auto-dismiss `CONCURRENT_WARNING_TTL_MS` later. If a new
 * warning arrives before the timer fires the timer is reset.
 *
 * Also exposes:
 *   – `broadcastSave` (immediate flush, used on deliberate save),
 *   – `broadcastEdit` (throttled, used on edit-in-progress events),
 *   – `dismiss` (manual clear),
 *
 * The channel and the auto-dismiss timer are cleaned up on unmount.
 */
export function useConcurrentEditWarning(
  noteId: string,
  currentUserId: string
): ConcurrentEditWarning {
  const [showWarning, setShowWarning] = useState(false);
  const [savedBy, setSavedBy] = useState<string | undefined>(undefined);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  // Auto-dismiss scheduler — shared pure helper so the 10s reset
  // semantics can be exercised in unit tests without a React renderer.
  const schedulerRef = useRef<ReturnType<typeof createWarningAutoDismiss> | null>(null);

  // Throttle state for broadcastEdit — kept in refs so rapid onChange
  // calls don't cause re-renders and so cleanup on unmount is trivial.
  const lastBroadcastTimeRef = useRef<number | null>(null);
  const lastBroadcastLineRef = useRef<number | null>(null);

  useEffect(() => {
    if (!noteId || !currentUserId) return;

    const supabase = createClient();
    supabaseRef.current = supabase;
    const channel = supabase.channel(`note_edits:${noteId}`);
    channelRef.current = channel;

    const scheduler = createWarningAutoDismiss((state) => {
      setShowWarning(state.showWarning);
      setSavedBy(state.savedBy);
    });
    schedulerRef.current = scheduler;

    channel.on(
      "broadcast",
      { event: "saved" },
      (payload) => {
        const data = payload.payload as {
          type: string;
          userId: string;
          displayName?: string;
          versionId?: string;
        };
        // Ignore our own save events.
        if (data.userId === currentUserId) return;
        // Each new event gives the user a fresh 10s: if a second
        // collaborator saves 9s after the first, we want the banner to
        // live the full 10s from the newer event rather than blink out
        // in 1s. `arrive` resets the timer internally.
        scheduler.arrive(data.displayName ?? "Someone");
      }
    );

    channel.subscribe();

    return () => {
      channelRef.current = null;
      scheduler.destroy();
      schedulerRef.current = null;
      // Reset throttle refs so a remount on a different note doesn't
      // inherit stale timing from the previous note's session.
      lastBroadcastTimeRef.current = null;
      lastBroadcastLineRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [noteId, currentUserId]);

  const broadcastSave = useCallback(
    (userId: string, displayName: string, versionId: string) => {
      const ch = channelRef.current;
      if (!ch) return;
      // A deliberate save is also a valid "recent broadcast" for
      // throttle purposes — collaborators saw us a moment ago, the
      // next edit-in-progress event can wait the full 3s window.
      lastBroadcastTimeRef.current = Date.now();
      void ch.send({
        type: "broadcast",
        event: "saved",
        payload: {
          type: "saved",
          userId,
          displayName,
          versionId,
        },
      });
    },
    []
  );

  const broadcastEdit = useCallback(
    (userId: string, displayName: string, line: number): boolean => {
      const ch = channelRef.current;
      if (!ch) return false;
      const now = Date.now();
      if (
        !shouldBroadcast(
          lastBroadcastTimeRef.current,
          lastBroadcastLineRef.current,
          now,
          line
        )
      ) {
        return false;
      }
      lastBroadcastTimeRef.current = now;
      lastBroadcastLineRef.current = line;
      void ch.send({
        type: "broadcast",
        event: "editing",
        payload: {
          type: "editing",
          userId,
          displayName,
          line,
        },
      });
      return true;
    },
    []
  );

  const dismiss = useCallback(() => {
    const scheduler = schedulerRef.current;
    if (scheduler) {
      scheduler.dismiss();
    } else {
      // No active scheduler (pre-subscribe or post-unmount) — still
      // flip the state flags so a synchronous dismiss() after a manual
      // setShowWarning(true) in tests works as expected.
      setShowWarning(false);
      setSavedBy(undefined);
    }
  }, []);

  return { showWarning, savedBy, broadcastSave, broadcastEdit, dismiss };
}
