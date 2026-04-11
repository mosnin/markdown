"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type Scope = "workspace" | "library" | "box" | "folder" | "object";

/**
 * WorkspaceLiveRefresh — scoped realtime updates via Supabase Realtime.
 *
 * Precision improvements:
 * 1. Only triggers refresh when the change matches the current scope
 * 2. Debounces rapid changes (350ms) to coalesce burst events
 * 3. Protects active editors from destabilizing refreshes
 * 4. Defers pending refreshes until editor focus is lost
 * 5. Uses a single debounce timer (not per-table)
 * 6. Does not fire when document is hidden (defers to visibility change)
 */
export function WorkspaceLiveRefresh({
  workspaceId,
  scope,
  boxId,
  folderId,
  objectType,
  objectId,
  protectWhileEditing = false,
}: {
  workspaceId: string;
  scope: Scope;
  boxId?: string | null;
  folderId?: string | null;
  objectType?: "note" | "file" | "skill" | "agent";
  objectId?: string;
  protectWhileEditing?: boolean;
}) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRefreshRef = useRef(false);
  const lastRefreshRef = useRef(0);

  const isEditingSurfaceActive = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const type = (active as HTMLInputElement).type;
      return !["checkbox", "radio", "button", "submit", "reset"].includes(type);
    }
    return active.isContentEditable;
  }, []);

  const hasDirtyEditor = useCallback(() =>
    document.querySelector('[data-editor-dirty="true"]') !== null, []);

  useEffect(() => {
    const supabase = createClient();

    const scheduleRefresh = () => {
      // Skip if document is hidden — will flush on visibility change
      if (document.hidden) {
        pendingRefreshRef.current = true;
        return;
      }

      // Skip if editor is active and protection is enabled
      if (protectWhileEditing && (isEditingSurfaceActive() || hasDirtyEditor())) {
        pendingRefreshRef.current = true;
        return;
      }

      // Throttle: don't refresh more than once per 500ms
      const now = Date.now();
      const timeSinceLast = now - lastRefreshRef.current;
      const delay = timeSinceLast < 500 ? 500 - timeSinceLast : 350;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        lastRefreshRef.current = Date.now();
        pendingRefreshRef.current = false;
        router.refresh();
      }, delay);
    };

    const shouldRefresh = (record: Record<string, unknown>) => {
      if (!record) return false;

      switch (scope) {
        case "workspace":
          return true;
        case "library":
          return record.is_reusable === true || record.box_id === null;
        case "box":
          return !boxId || record.box_id === boxId;
        case "folder":
          // Only refresh for direct folder children changes
          return (
            record.folder_id === folderId ||
            record.id === folderId ||
            record.parent_folder_id === folderId
          );
        case "object":
          if (!objectId) return false;
          if (record.id === objectId) return true;
          if (record.object_id === objectId && (!objectType || record.object_type === objectType)) return true;
          return false;
        default:
          return false;
      }
    };

    const onPayload = (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => {
      const candidate = payload.new ?? payload.old;
      if (!candidate) return;
      if (shouldRefresh(candidate)) scheduleRefresh();
    };

    // Subscribe to relevant tables with workspace filter
    const channel = supabase
      .channel(`live-refresh:${scope}:${workspaceId}:${boxId ?? "none"}:${folderId ?? "none"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "folders", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "files", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "skills", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "agents", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspace_objects", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .subscribe();

    // Flush pending refresh when focus returns or visibility changes
    const flushPending = () => {
      if (!pendingRefreshRef.current) return;
      if (document.hidden) return;
      if (protectWhileEditing && (isEditingSurfaceActive() || hasDirtyEditor())) return;
      pendingRefreshRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      lastRefreshRef.current = Date.now();
      timerRef.current = setTimeout(() => router.refresh(), 100);
    };

    window.addEventListener("focus", flushPending);
    document.addEventListener("visibilitychange", flushPending);
    // Check less frequently — every 5s instead of 2s to reduce overhead
    const pendingCheck = setInterval(flushPending, 5000);

    return () => {
      window.removeEventListener("focus", flushPending);
      document.removeEventListener("visibilitychange", flushPending);
      clearInterval(pendingCheck);
      if (timerRef.current) clearTimeout(timerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, scope, boxId, folderId, objectId, objectType, protectWhileEditing, router, isEditingSurfaceActive, hasDirtyEditor]);

  return null;
}
