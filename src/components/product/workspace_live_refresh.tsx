"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type Scope = "workspace" | "library" | "box" | "folder" | "object";

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

  useEffect(() => {
    const supabase = createClient();

    const isEditingSurfaceActive = () => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return false;
      const tag = active.tagName.toLowerCase();
      if (tag === "textarea") return true;
      if (tag === "input") {
        const type = (active as HTMLInputElement).type;
        return !["checkbox", "radio", "button", "submit", "reset"].includes(type);
      }
      return active.isContentEditable;
    };

    const hasDirtyEditor = () =>
      document.querySelector('[data-editor-dirty="true"]') !== null;

    const scheduleRefresh = () => {
      if (protectWhileEditing && (isEditingSurfaceActive() || hasDirtyEditor())) {
        pendingRefreshRef.current = true;
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => router.refresh(), 250);
    };

    const shouldRefresh = (record: Record<string, unknown>) => {
      if (!record) return false;
      if (scope === "workspace") return true;
      if (scope === "library") {
        return record.is_reusable === true || record.box_id === null;
      }
      if (scope === "box") return !boxId || record.box_id === boxId;
      if (scope === "folder") return record.folder_id === folderId || record.id === folderId || record.parent_folder_id === folderId;
      if (scope === "object") {
        if (!objectId) return false;
        if (record.id === objectId) return true;
        if (record.object_id === objectId && (!objectType || record.object_type === objectType)) return true;
        return false;
      }
      return false;
    };

    const onPayload = (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => {
      const candidate = payload.new ?? payload.old;
      if (!candidate) return;
      if (shouldRefresh(candidate)) scheduleRefresh();
    };

    const channel = supabase
      .channel(`live-refresh:${scope}:${workspaceId}:${boxId ?? "none"}:${folderId ?? "none"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "folders", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "files", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "skills", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "agents", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspace_objects", filter: `workspace_id=eq.${workspaceId}` }, onPayload)
      .subscribe();

    const flushPending = () => {
      if (!pendingRefreshRef.current) return;
      if (protectWhileEditing && (isEditingSurfaceActive() || hasDirtyEditor())) return;
      pendingRefreshRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => router.refresh(), 100);
    };
    window.addEventListener("focus", flushPending);
    document.addEventListener("visibilitychange", flushPending);
    const pendingCheck = setInterval(flushPending, 2000);

    return () => {
      window.removeEventListener("focus", flushPending);
      document.removeEventListener("visibilitychange", flushPending);
      clearInterval(pendingCheck);
      if (timerRef.current) clearTimeout(timerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, scope, boxId, folderId, objectId, objectType, protectWhileEditing, router]);

  return null;
}
