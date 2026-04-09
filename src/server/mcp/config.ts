/**
 * Configuration for the MCP server standalone process.
 * All values come from environment variables validated at startup.
 */

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Required environment variable ${name} is not set`);
  return val;
}

export interface McpConfig {
  /** Base URL of the running Context Store app, e.g. http://localhost:3000 */
  apiBaseUrl: string;
  /** Bearer secret issued by the Connections UI — starts with csk_v1_ */
  connectionSecret: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(): McpConfig {
  const apiBaseUrl = requireEnv("CONTEXT_STORE_API_BASE_URL").replace(/\/$/, "");
  const connectionSecret = requireEnv("CONTEXT_STORE_CONNECTION_SECRET");

  const rawLogLevel = process.env.CONTEXT_STORE_MCP_LOG_LEVEL ?? "info";
  const logLevel = (["debug", "info", "warn", "error"].includes(rawLogLevel)
    ? rawLogLevel
    : "info") as McpConfig["logLevel"];

  return { apiBaseUrl, connectionSecret, logLevel };
}
