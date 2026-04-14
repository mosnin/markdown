import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET as getOAuthMeta } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as getMcpMeta } from "@/app/.well-known/mcp-server/route";
import { GET as getProtectedMeta } from "@/app/api/mcp/route";

const envBackup = { ...process.env };

describe("discovery endpoint consistency", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://context.example.com";
    delete process.env.NEXT_PUBLIC_CANONICAL_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("publishes coherent OAuth + MCP URLs from NEXT_PUBLIC_APP_URL", async () => {
    const oauthRes = await getOAuthMeta();
    const oauth = await oauthRes.json();

    const mcpRes = await getMcpMeta();
    const mcp = await mcpRes.json();

    const protectedRes = await getProtectedMeta();
    const protectedMeta = await protectedRes.json();

    expect(oauth.issuer).toBe("https://context.example.com");
    expect(oauth.authorization_endpoint).toBe("https://context.example.com/oauth/authorize");
    expect(oauth.token_endpoint).toBe("https://context.example.com/api/oauth/token");
    expect(oauth.revocation_endpoint).toBe("https://context.example.com/api/oauth/revoke");

    expect(mcp.mcp_server_url).toBe("https://context.example.com/api/mcp");
    expect(mcp.authorization_server_metadata).toBe(
      "https://context.example.com/.well-known/oauth-authorization-server"
    );

    expect(protectedMeta.resource).toBe("https://context.example.com/api/mcp");
    expect(protectedMeta.authorization_servers).toEqual(["https://context.example.com"]);
  });
});
