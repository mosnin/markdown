"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type Scope = "workspace" | "library" | "box" | "folder";

export function WorkspaceLiveRefresh({
  workspaceId,
  scope,
  boxId,
  folderId,
}: {
  workspaceId: string;
  scope: Scope;
  boxId?: string | null;
  folderId?: string | null;
}) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const scheduleRefresh = () => {
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
      .subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, scope, boxId, folderId, router]);

  return null;
}

