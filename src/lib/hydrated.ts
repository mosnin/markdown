"use client";

import { useSyncExternalStore } from "react";

const subscribe = (): (() => void) => () => {};

/**
 * False during server rendering and the hydration pass, true on every client
 * render after it. The one honest way to read a value the server could not
 * have known (a live query that may already be answered, a browser setting)
 * without the first client frame disagreeing with the HTML it is hydrating.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
