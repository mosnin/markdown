import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end contract test for the Claude Code hook shim.
 *
 * The CLI is executed as a real process, fed real hook payloads on stdin, and
 * pointed at a stub relay that records what it receives. Everything asserted
 * here was checked against an actual Claude Code transcript first — in
 * particular the failure shape of `tool_response`, which is a bare string and
 * not the object the documentation implies.
 *
 * This is the layer that used to be untested: the parser had unit tests, but
 * nothing established that the hook the agent actually runs produces the
 * events the relay expects.
 */

interface Received {
  path: string;
  method: string;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let received: Received[] = [];
let workdir: string;

const CLI = join(process.cwd(), "cli", "poggle.mjs");

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { _raw: raw };
      }
      received.push({ path: req.url ?? "", method: req.method ?? "", body });

      if ((req.url ?? "").startsWith("/api/v1/relay/handoff")) {
        res.writeHead(200, { "content-type": "text/markdown" });
        res.end("# Handoff\nPrevious agent was mid-migration.");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { session_id: "sess-test-1", accepted: 1 } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  workdir = mkdtempSync(join(tmpdir(), "poggle-hook-"));
  writeFileSync(
    join(workdir, ".poggle.json"),
    JSON.stringify({ project: "test-project", api_url: baseUrl })
  );
});

/**
 * Run the CLI as a real child process and wait for it to actually exit.
 *
 * The payload goes in on stdin exactly as the runtime delivers it, and the
 * promise settles on `close` rather than on the callback so that every request
 * the shim makes has landed on the stub before anything is asserted.
 */
function runCli(
  args: string[],
  apiUrl: string,
  payload: Record<string, unknown>
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: workdir,
      env: {
        ...process.env,
        POGGLE_API_URL: apiUrl,
        POGGLE_TOKEN: "pgr_v1_" + "a".repeat(64),
        POGGLE_PROJECT: "test-project",
        HOME: workdir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));

    child.stdin.end(JSON.stringify(payload));
  });
}

function fireHook(
  hookName: string,
  payload: Record<string, unknown>
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runCli(["hook", hookName], baseUrl, payload);
}

/** The fields Claude Code puts on every hook invocation. */
const COMMON = {
  session_id: "de3233a3-b4d4-55df-9078-24863606a520",
  transcript_path: "/nonexistent/transcript.jsonl",
  cwd: "/repo",
  permission_mode: "default",
};

function eventsSent(): Array<Record<string, unknown>> {
  return received
    .filter((r) => r.path === "/api/v1/relay/events")
    .flatMap((r) => (r.body.events as Array<Record<string, unknown>>) ?? []);
}

describe("Claude Code hook contract", () => {
  it("opens a session and returns the brief as additionalContext", async () => {
    const { stdout } = await fireHook("SessionStart", {
      ...COMMON,
      hook_event_name: "SessionStart",
      source: "startup",
    });

    expect(eventsSent().map((e) => e.event_type)).toContain("session_start");

    // The runtime only injects context it can parse. A malformed envelope is
    // silently dropped, so the shape matters as much as the content.
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("Handoff");
  });

  it("detects a failed tool call from the string response shape", async () => {
    // Verbatim from a real transcript: a non-zero Bash exit arrives as a bare
    // string, with no `success`, `error` or `is_error` field anywhere.
    await fireHook("PostToolUse", {
      ...COMMON,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "git push" },
      tool_response: "Error: Exit code 128\nfatal: could not read Username",
    });

    const events = eventsSent();
    expect(events.map((e) => e.event_type)).toContain("tool_error");
    const failure = events.find((e) => e.event_type === "tool_error");
    expect(String(failure?.summary)).toContain("FAILED");
    expect(String((failure?.payload as Record<string, unknown>)?.error)).toContain(
      "Exit code 128"
    );
  });

  it("raises usage_limit when a cap arrives in the string response", async () => {
    // The signal the entire product exists to catch. Under the old object-only
    // checks this could never fire, because the text lives in a string.
    await fireHook("PostToolUse", {
      ...COMMON,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "claude -p 'go'" },
      tool_response:
        "Error: Usage limit reached. Your limit will reset at 3pm.",
    });

    const events = eventsSent();
    expect(events.map((e) => e.event_type)).toContain("usage_limit");
    expect(events.find((e) => e.event_type === "usage_limit")?.importance).toBe(5);
  });

  it("does not treat a successful command with stderr output as a failure", async () => {
    // Successful commands write to stderr constantly. Keying failure off it
    // would mark most of the log failed.
    await fireHook("PostToolUse", {
      ...COMMON,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response: {
        stdout: "all good",
        stderr: "npm notice: new version available",
        interrupted: false,
        isImage: false,
      },
    });

    const events = eventsSent();
    expect(events.map((e) => e.event_type)).not.toContain("tool_error");
  });

  it("does NOT end the session on Stop — Stop is a turn boundary", async () => {
    // Stop fires after every assistant reply. Ending the session here marked a
    // working agent dead after its first response, released the claims it was
    // still relying on, and reported its work finished.
    await fireHook("SessionStart", {
      ...COMMON,
      hook_event_name: "SessionStart",
      source: "startup",
    });
    received = [];

    await fireHook("Stop", {
      ...COMMON,
      hook_event_name: "Stop",
      stop_hook_active: false,
    });

    const ends = received.filter(
      (r) => r.method === "PATCH" && r.body.action === "end"
    );
    expect(ends).toHaveLength(0);
    expect(eventsSent().map((e) => e.event_type)).not.toContain("session_end");
  });

  it("ends the session on SessionEnd without claiming it completed", async () => {
    await fireHook("SessionStart", {
      ...COMMON,
      hook_event_name: "SessionStart",
      source: "startup",
    });
    received = [];

    // Claude Code's real reasons. None of them is evidence of completion.
    await fireHook("SessionEnd", {
      ...COMMON,
      hook_event_name: "SessionEnd",
      reason: "prompt_input_exit",
    });

    const end = received.find(
      (r) => r.method === "PATCH" && r.body.action === "end"
    );
    expect(end).toBeDefined();
    expect(end?.body.end_reason).toBe("user_stopped");
    expect(end?.body.end_reason).not.toBe("completed");
  });

  it("maps an unrecognised end reason to unknown, never to completed", async () => {
    await fireHook("SessionStart", {
      ...COMMON,
      hook_event_name: "SessionStart",
      source: "startup",
    });
    received = [];

    await fireHook("SessionEnd", {
      ...COMMON,
      hook_event_name: "SessionEnd",
      reason: "other",
    });

    const end = received.find(
      (r) => r.method === "PATCH" && r.body.action === "end"
    );
    expect(end?.body.end_reason).toBe("unknown");
  });

  it("always exits 0 so a relay problem never breaks the agent", async () => {
    // The shim runs inside someone's agent. It must be incapable of stopping
    // it, even pointed at a port with nothing listening.
    const result = await runCli(
      ["hook", "PostToolUse"],
      "http://127.0.0.1:1",
      { ...COMMON, tool_name: "Read", tool_input: { file_path: "/repo/a.ts" } }
    );
    expect(result.code).toBe(0);
  });
});
