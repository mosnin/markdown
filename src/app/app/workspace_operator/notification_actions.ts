"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  getNotificationPrefs,
  setNotificationPrefs,
  type OperatorNotificationPrefs,
} from "@/server/services/operator_notifications_service";

/**
 * Operator notification preferences — get/set wrappers.
 *
 * Imports `operator_notifications_service` from Wave 1 G. If that
 * module does not yet exist at integration time, the import will fail
 * to type-check; the orchestrator's integration pass reconciles by
 * landing G's service or by stubbing it temporarily.
 */

export type NotificationActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const SETTINGS_PATH = "/app/settings/operator_preferences";

export async function getOperatorNotificationPrefsAction(): Promise<
  NotificationActionResult<OperatorNotificationPrefs>
> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const prefs = await getNotificationPrefs(supabase, ctx.user.id);
    return { ok: true, data: prefs };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to load notification preferences.",
    };
  }
}

export interface SetOperatorNotificationPrefsInput {
  emailOnComplete?: boolean;
  emailOnFail?: boolean;
}

export async function setOperatorNotificationPrefsAction(
  input: SetOperatorNotificationPrefsInput
): Promise<NotificationActionResult<OperatorNotificationPrefs>> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const next = await setNotificationPrefs(supabase, ctx.user.id, input);
    try {
      revalidatePath(SETTINGS_PATH);
    } catch {
      /* see prompts_actions.ts */
    }
    return { ok: true, data: next };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to save notification preferences.",
    };
  }
}
