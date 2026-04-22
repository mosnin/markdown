/**
 * Workflow runtime template interpolation.
 *
 * Resolves `{{nodeKey.path}}` references against a context map keyed by
 * node_key. Used by the execution engine to wire upstream node outputs
 * into downstream prompts, URLs, queries, and condition expressions.
 *
 * Never throws — any invalid path logs a console.warn and resolves to
 * the empty string, matching the "missing paths resolve to empty string
 * with a warning event" semantics described in docs/workflows_v1.md.
 */

const TEMPLATE_GROUP_RE = /{{\s*([^}]+?)\s*}}/g;

/**
 * Resolve a template against a map of node outputs. Missing paths resolve
 * to empty string. Never throws — invalid paths log a console.warn and
 * return "".
 */
export function resolveTemplate(
  template: string,
  context: Record<string, Record<string, unknown>>
): string {
  return template.replace(TEMPLATE_GROUP_RE, (_match, rawPath: string) => {
    const path = rawPath.trim();
    const resolved = resolvePath(path, context);
    if (resolved === undefined || resolved === null) return "";
    if (typeof resolved === "string") return resolved;
    if (typeof resolved === "number" || typeof resolved === "boolean") {
      return String(resolved);
    }
    try {
      return JSON.stringify(resolved);
    } catch {
      console.warn(
        `[workflow_template] failed to stringify value at path "${path}"`
      );
      return "";
    }
  });
}

/**
 * Parse a dotted path with optional `[N]` indexers and walk `context`.
 * Returns undefined on any failure — caller turns undefined into "".
 */
function resolvePath(
  path: string,
  context: Record<string, Record<string, unknown>>
): unknown {
  const parts = splitPath(path);
  if (parts === null || parts.length === 0) {
    console.warn(`[workflow_template] invalid path "${path}"`);
    return undefined;
  }

  // First segment must be a node_key (a string key on context).
  const head = parts[0];
  if (typeof head !== "string") {
    console.warn(
      `[workflow_template] path "${path}" must start with a node_key`
    );
    return undefined;
  }
  let current: unknown = context[head];

  for (let i = 1; i < parts.length; i++) {
    if (current === null || current === undefined) return undefined;
    const seg = parts[i];
    if (typeof seg === "number") {
      if (!Array.isArray(current)) {
        console.warn(
          `[workflow_template] path "${path}" expected array at segment ${i}`
        );
        return undefined;
      }
      current = current[seg];
    } else {
      if (typeof current !== "object") {
        console.warn(
          `[workflow_template] path "${path}" expected object at segment "${seg}"`
        );
        return undefined;
      }
      current = (current as Record<string, unknown>)[seg];
    }
  }

  return current;
}

/**
 * Split a path string like `nodeKey.arr[0].title` into:
 *   ["nodeKey", "arr", 0, "title"]
 * Returns null if the syntax is malformed.
 */
function splitPath(path: string): Array<string | number> | null {
  const out: Array<string | number> = [];
  const dotParts = path.split(".");
  for (const rawSegment of dotParts) {
    if (rawSegment.length === 0) return null;

    // Capture leading identifier, then zero or more [N] indexers.
    const match = rawSegment.match(/^([a-zA-Z_][a-zA-Z0-9_]*)((?:\[\d+\])*)$/);
    if (!match) return null;
    const [, ident, indexBlob] = match;
    out.push(ident);
    if (indexBlob) {
      const idxRe = /\[(\d+)\]/g;
      let m: RegExpExecArray | null;
      while ((m = idxRe.exec(indexBlob)) !== null) {
        out.push(Number.parseInt(m[1], 10));
      }
    }
  }
  return out;
}
