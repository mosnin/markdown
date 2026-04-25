"use client";

import { ObjectHistoryPanel } from "./object_history_panel";
import { ObjectLifecyclePanel } from "./object_lifecycle_panel";
import {
  rollbackAgentAction,
  archiveAgentAction,
  unarchiveAgentAction,
  trashAgentAction,
  restoreAgentAction,
} from "@/app/app/agents/lifecycle_actions";
import type { ObjectVersion } from "@/server/domain/types/object_version";

interface VersionWithCurrent extends ObjectVersion {
  is_current: boolean;
}

/**
 * AgentHistoryPanel
 *
 * Client-side wrapper that wires the generic ObjectHistoryPanel to the
 * agent-specific rollback action.
 */
export function AgentHistoryPanel({
  agentId,
  versions,
  currentVersionId,
  rollbackDisabled,
}: {
  agentId: string;
  versions: VersionWithCurrent[];
  currentVersionId: string | null;
  rollbackDisabled?: boolean;
}) {
  return (
    <ObjectHistoryPanel
      objectType="agent"
      objectId={agentId}
      versions={versions}
      currentVersionId={currentVersionId}
      onRollback={(versionId) => rollbackAgentAction(agentId, versionId)}
      rollbackDisabled={rollbackDisabled}
    />
  );
}

/**
 * AgentLifecycleControls
 *
 * Client-side wrapper that wires the generic ObjectLifecyclePanel to
 * agent-specific lifecycle actions.
 */
export function AgentLifecycleControls({
  agentId,
  currentStatus,
  agentName,
}: {
  agentId: string;
  currentStatus: "draft" | "active" | "archived" | "trashed";
  agentName: string;
}) {
  return (
    <ObjectLifecyclePanel
      objectId={agentId}
      objectType="agent"
      currentStatus={currentStatus}
      objectName={agentName}
      onArchive={archiveAgentAction}
      onUnarchive={unarchiveAgentAction}
      onTrash={trashAgentAction}
      onRestore={restoreAgentAction}
    />
  );
}
