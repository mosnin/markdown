import { describe, it, expect } from "vitest";
import {
  isValidRedirectUri,
  redirectUriError,
} from "@/app/app/settings/oauth_clients/wizard_validators";

describe("oauth_wizard_validators — isValidRedirectUri", () => {
  it("accepts https://… URLs", () => {
    expect(isValidRedirectUri("https://foo.com")).toBe(true);
    expect(isValidRedirectUri("https://foo.com/callback")).toBe(true);
    expect(isValidRedirectUri("https://sub.example.com/oauth/cb?x=1")).toBe(true);
  });

  it("rejects plain http:// URLs on non-loopback hosts", () => {
    expect(isValidRedirectUri("http://foo.com")).toBe(false);
    expect(isValidRedirectUri("http://example.com/callback")).toBe(false);
    expect(isValidRedirectUri("http://192.168.1.10/callback")).toBe(false);
  });

  it("accepts http:// URLs on localhost / 127.0.0.1 (loopback exception)", () => {
    expect(isValidRedirectUri("http://localhost/callback")).toBe(true);
    expect(isValidRedirectUri("http://localhost:3000/callback")).toBe(true);
    expect(isValidRedirectUri("http://127.0.0.1:8080/cb")).toBe(true);
  });

  it("rejects invalid URLs and unknown schemes", () => {
    expect(isValidRedirectUri("")).toBe(false);
    expect(isValidRedirectUri("not-a-url")).toBe(false);
    expect(isValidRedirectUri("foo.com/callback")).toBe(false);
    expect(isValidRedirectUri("ftp://foo.com")).toBe(false);
    expect(isValidRedirectUri("javascript:alert(1)")).toBe(false);
  });
});

describe("oauth_wizard_validators — redirectUriError", () => {
  it("returns null for valid URIs", () => {
    expect(redirectUriError("https://foo.com")).toBeNull();
    expect(redirectUriError("http://localhost:3000/cb")).toBeNull();
  });

  it("flags http:// on non-loopback as HTTPS-required", () => {
    const err = redirectUriError("http://foo.com");
    expect(err).toBeTruthy();
    expect(err).toMatch(/localhost/);
  });

  it("flags garbage as not-a-URL", () => {
    expect(redirectUriError("")).toBe("Required.");
    expect(redirectUriError("not-a-url")).toMatch(/valid/i);
  });

  it("flags non-http(s) schemes", () => {
    expect(redirectUriError("ftp://foo.com")).toMatch(/not allowed/);
  });
});
