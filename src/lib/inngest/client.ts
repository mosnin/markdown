/**
 * Inngest client singleton.
 *
 * Publish events with `inngest.send({ name, data })`. Consume events
 * with function definitions registered in the /api/inngest route.
 *
 * See docs/automation_v1.md for the full architecture.
 */
import { Inngest, EventSchemas } from "inngest";
import type { AppEvents } from "@/lib/inngest/events";

export const inngest = new Inngest({
  id: "poggle",
  schemas: new EventSchemas().fromRecord<AppEvents>(),
  // Event key: required for production. In dev mode (INNGEST_DEV=1) the
  // inngest-cli dev server accepts unauthenticated publishes, so this
  // can be any string locally.
  eventKey: process.env.INNGEST_EVENT_KEY,
  // Dev server URL override — only used when running against the local
  // inngest-cli dev server.
  isDev: process.env.INNGEST_DEV === "1",
});
