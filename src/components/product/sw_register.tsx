"use client";

import { useEffect } from "react";

/**
 * Registers the Poggle service worker once per page load.
 *
 * Service workers are scoped to their serving directory; ours lives at
 * `/sw.js` so it controls the entire origin. We register lazily on
 * window load so it doesn't compete with first paint.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Skip in dev to avoid HMR/cache friction
    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          console.warn("[sw] register failed", err);
        });
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad);
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
