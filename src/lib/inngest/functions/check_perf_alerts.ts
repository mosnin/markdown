/**
 * Performance-alert cron.
 *
 * Runs every 5 minutes. For each route class, looks at the trailing 1 h
 * p95 and raises a `perf_alerts` row + Sentry warning when the class is
 * in the `red` (`fail`) tier. The underlying service is idempotent within
 * a 6 h window per class, so it's safe to fire often.
 *
 * The schedule is short by design (5 min) to keep alert latency tight
 * while sampling already provides plenty of buffer against flaps. If you
 * tighten the dedupe window in `perf_alert_service.ts`, revisit here.
 */
import { inngest } from "@/lib/inngest/client";
import { checkPerfAlerts } from "@/server/services/perf_alert_service";

export const checkPerfAlertsFunction = inngest.createFunction(
  {
    id: "check-perf-alerts",
    name: "Check performance alerts",
  },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    return step.run("evaluate-route-class-p95", async () => {
      return checkPerfAlerts();
    });
  },
);
