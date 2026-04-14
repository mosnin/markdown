import { afterEach, describe, expect, it } from "vitest";
import { validateServerEnv } from "@/lib/env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("validateServerEnv", () => {
  it("accepts NEXT_PUBLIC_CANONICAL_URL when NEXT_PUBLIC_APP_URL is unset", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_CANONICAL_URL = "https://app.example.com";

    expect(() => validateServerEnv()).not.toThrow();
  });

  it("fails when no public app URL env is set", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_CANONICAL_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;

    expect(() => validateServerEnv()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
