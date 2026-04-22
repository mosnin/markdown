/**
 * Inngest webhook handler.
 *
 * Inngest calls this endpoint to invoke registered functions. The `serve`
 * helper handles GET (health check), POST (function invocation), and PUT
 * (function registration) verbs.
 *
 * All Inngest functions are registered in src/lib/inngest/functions/index.ts.
 * Add new functions there — this route imports the barrel export so no
 * per-function registration is needed here.
 */
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { allFunctions } from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: allFunctions,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
