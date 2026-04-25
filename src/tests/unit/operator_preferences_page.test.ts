import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Module surface contract for the operator preferences page + its action
// helpers. Mirrors operator_panel_quota.test.tsx — no DOM, just verifies
// the modules are statically importable and export the right shapes so
// a refactor that drops the default export or the named action
// signatures fails CI.
// ---------------------------------------------------------------------------

import OperatorPreferencesPage from "@/app/app/settings/operator_preferences/page";
import {
  getOperatorNotificationPrefsAction,
  setOperatorNotificationPrefsAction,
} from "@/app/app/workspace_operator/notification_actions";
import {
  listOperatorApiKeysAction,
  createOperatorApiKeyAction,
  revokeOperatorApiKeyAction,
} from "@/app/app/workspace_operator/api_keys_actions";
import { OperatorNotificationPrefsCard } from "@/components/product/operator/operator_notification_prefs";
import { OperatorApiKeysManager } from "@/components/product/operator/operator_api_keys_manager";

describe("operator_preferences page module surface", () => {
  it("default-exports the page as a function", () => {
    expect(typeof OperatorPreferencesPage).toBe("function");
  });

  it("exports the notification prefs card", () => {
    expect(typeof OperatorNotificationPrefsCard).toBe("function");
  });

  it("exports the api keys manager", () => {
    expect(typeof OperatorApiKeysManager).toBe("function");
  });
});

describe("operator notification + api key action surface", () => {
  it("notification actions are exported as functions", () => {
    expect(typeof getOperatorNotificationPrefsAction).toBe("function");
    expect(typeof setOperatorNotificationPrefsAction).toBe("function");
  });

  it("api key actions are exported as functions", () => {
    expect(typeof listOperatorApiKeysAction).toBe("function");
    expect(typeof createOperatorApiKeyAction).toBe("function");
    expect(typeof revokeOperatorApiKeyAction).toBe("function");
  });
});
