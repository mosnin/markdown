"use client";

import { ObjectHistoryPanel } from "../object_history_panel";
import { ObjectLifecyclePanel } from "../object_lifecycle_panel";
import {
  rollbackSkillAction,
  archiveSkillAction,
  unarchiveSkillAction,
  trashSkillAction,
  restoreSkillAction,
} from "@/app/app/skills/lifecycle_actions";
import type { ObjectVersion } from "@/server/domain/types/object_version";

interface VersionWithCurrent extends ObjectVersion {
  is_current: boolean;
}

/**
 * SkillHistoryPanel
 *
 * Client-side wrapper that wires the generic ObjectHistoryPanel to the
 * skill-specific rollback action. Needed because server action functions
 * cannot be directly passed as arbitrary JSX props from server components.
 */
export function SkillHistoryPanel({
  skillId,
  versions,
  currentVersionId,
  rollbackDisabled,
}: {
  skillId: string;
  versions: VersionWithCurrent[];
  currentVersionId: string | null;
  rollbackDisabled?: boolean;
}) {
  return (
    <ObjectHistoryPanel
      objectType="skill"
      objectId={skillId}
      versions={versions}
      currentVersionId={currentVersionId}
      onRollback={(versionId) => rollbackSkillAction(skillId, versionId)}
      rollbackDisabled={rollbackDisabled}
    />
  );
}

/**
 * SkillLifecycleControls
 *
 * Client-side wrapper that wires the generic ObjectLifecyclePanel to
 * skill-specific lifecycle actions.
 */
export function SkillLifecycleControls({
  skillId,
  currentStatus,
  skillName,
}: {
  skillId: string;
  currentStatus: "draft" | "active" | "archived" | "trashed";
  skillName: string;
}) {
  return (
    <ObjectLifecyclePanel
      objectId={skillId}
      objectType="skill"
      currentStatus={currentStatus}
      objectName={skillName}
      onArchive={archiveSkillAction}
      onUnarchive={unarchiveSkillAction}
      onTrash={trashSkillAction}
      onRestore={restoreSkillAction}
    />
  );
}
