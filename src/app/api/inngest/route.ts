/**
 * Inngest webhook handler.
 *
 * Inngest calls this endpoint to invoke registered functions. The `serve`
 * helper handles GET (health check), POST (function invocation), and PUT
 * (function registration) verbs.
 *
 * Functions are registered in src/lib/inngest/functions/index.ts (added
 * by Phase 2C). Until that module exists we register an empty array so
 * the endpoint 200s and Inngest's dev server doesn't error out.
 */
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";

// Import the functions array lazily so this route keeps working even
// before Phase 2C lands. The helper resolves at module load time.
async function loadFunctions() {
  try {
    const mod = await import("@/lib/inngest/functions");
    return mod.allFunctions ?? [];
  } catch {
    return [];
  }
}

// The `serve` wrapper accepts a plain array of functions. We build it once
// at module load — any cold start will re-resolve it.
const functionsPromise = loadFunctions();

async function handler(req: Request) {
  const functions = await functionsPromise;
  const inngestHandler = serve({
    client: inngest,
    functions,
    signingKey: process.env.INNGEST_SIGNING_KEY,
  });
  // serve() returns a handler object { GET, POST, PUT }. Dispatch on method.
  const method = req.method as "GET" | "POST" | "PUT";
  const fn = inngestHandler[method];
  if (!fn) return new Response("Method not allowed", { status: 405 });
  return fn(req as never);
}

export { handler as GET, handler as POST, handler as PUT };
