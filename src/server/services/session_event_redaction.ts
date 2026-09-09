/**
 * Server-side scrubbing for ingested agent events.
 *
 * Why this exists: agent event payloads are the most secret-dense data this
 * product will ever hold. A single PostToolUse hook can carry the contents of
 * a .env file, an `aws configure` command line, a stack trace with a database
 * URL, or the full text of a private source file. The hook shims redact at the
 * edge before sending, but the edge is code we do not control once installed —
 * an old shim, a custom integration, or a curl one-liner will send raw text.
 * So we scrub again here, on the way in, and treat the client-side pass as an
 * optimisation rather than a guarantee.
 *
 * Design constraints:
 *   - Never throw. A redaction failure must not reject an event; losing the
 *     log entry is worse than storing one imperfectly scrubbed string.
 *   - Bounded cost. Ingest is on the hot path of every agent tool call, so
 *     this walks a payload once, with a depth and size cap.
 *   - Redact in place, keep the shape. Readers and the brief assembler expect
 *     the same keys either way; only the values change.
 */

/** Keys whose values are replaced wholesale, regardless of content. */
const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /pass(word|wd)?$/i,
  /secret/i,
  /token/i,
  /api[-_]?key/i,
  /auth/i,
  /credential/i,
  /private[-_]?key/i,
  /session[-_]?key/i,
  /^cookie$/i,
  /^authorization$/i,
];

/**
 * Value patterns that look like credentials wherever they appear.
 *
 * Ordered most-specific first: a GitHub token would also match the generic
 * long-hex rule, and we would rather label it precisely.
 */
const VALUE_PATTERNS: readonly { re: RegExp; replacement: string }[] = [
  { re: /\bBearer\s+[A-Za-z0-9_\-.=]+/gi, replacement: "Bearer <redacted>" },
  // This product's own credentials come first: a relay key logged by a hook
  // that dumped its own config is the most likely secret in this whole corpus.
  { re: /\bpgr_v1_[0-9a-f]{64}\b/g, replacement: "pgr_v1_<redacted>" },
  { re: /\bcsk_v1_[A-Za-z0-9_-]+/g, replacement: "csk_v1_<redacted>" },
  { re: /\bcso_[ar]_[A-Za-z0-9_-]+/g, replacement: "cso_<redacted>" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, replacement: "<github-token>" },
  // sk-ant- must precede the generic sk- rule, which would otherwise claim it.
  { re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, replacement: "<anthropic-key>" },
  { re: /\bsk-[A-Za-z0-9_-]{16,}/g, replacement: "<api-key>" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "<aws-access-key-id>" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: "<slack-token>" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: "<jwt>" },
  // Connection strings: keep the scheme and host, drop the credentials.
  {
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s:/@]+@/gi,
    replacement: "$1<redacted>@",
  },
  // KEY=value assignments in shell/env text where the key looks sensitive.
  {
    re: /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIALS)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|\S+)/g,
    replacement: "$1=<redacted>",
  },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "<private-key>" },
];

/** Maximum object depth we descend. Deeper values are dropped, not kept raw. */
const MAX_DEPTH = 8;
/** Maximum number of values we scrub in one payload before we stop descending. */
const MAX_NODES = 2000;
/** Strings longer than this are truncated after scrubbing. */
const MAX_STRING_LEN = 16 * 1024;

const REDACTED = "<redacted>";

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Scrub credential-shaped substrings out of one string.
 *
 * Exported for the hook shims' test suite and for reuse on `summary`, which is
 * plain text rather than structured payload.
 */
export function redactString(input: string): string {
  let out = input;
  for (const { re, replacement } of VALUE_PATTERNS) {
    // Patterns carry the /g flag, so reset lastIndex between calls.
    re.lastIndex = 0;
    out = out.replace(re, replacement);
  }
  if (out.length > MAX_STRING_LEN) {
    out = `${out.slice(0, MAX_STRING_LEN)}… <truncated ${out.length - MAX_STRING_LEN} chars>`;
  }
  return out;
}

interface WalkState {
  nodes: number;
}

function walk(value: unknown, depth: number, state: WalkState): unknown {
  if (state.nodes >= MAX_NODES) return REDACTED;
  state.nodes += 1;

  if (value === null || value === undefined) return value;

  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (depth >= MAX_DEPTH) return REDACTED;

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, depth + 1, state));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : walk(item, depth + 1, state);
    }
    return out;
  }

  // Functions, symbols, bigints: not representable in jsonb anyway.
  return REDACTED;
}

/**
 * Scrub an event payload.
 *
 * Returns a new object; the input is never mutated. Returns null for a null
 * or unusable payload so callers can store SQL NULL rather than `{}`.
 */
export function redactPayload(
  payload: unknown
): Record<string, unknown> | null {
  if (payload === null || payload === undefined) return null;
  try {
    const scrubbed = walk(payload, 0, { nodes: 0 });
    if (scrubbed === null || typeof scrubbed !== "object" || Array.isArray(scrubbed)) {
      // Wrap non-object payloads so the column shape stays predictable.
      return { value: scrubbed };
    }
    return scrubbed as Record<string, unknown>;
  } catch {
    // Never let redaction cost us the event.
    return { redaction_error: true };
  }
}

/**
 * Scrub a file path list.
 *
 * Paths are not usually secret, but a home directory leaks a username and an
 * absolute path leaks machine layout. We keep paths readable and drop the
 * user-identifying prefix.
 */
export function redactFilePaths(files: readonly string[]): string[] {
  return files.map((file) =>
    file
      .replace(/^\/(?:home|Users)\/[^/]+/, "~")
      .replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~")
  );
}
