import { type NextRequest } from "next/server";
import { apiOk, apiError, E_INTERNAL } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  best_k_silhouette,
  l2_normalize,
  seedFromString,
} from "@/server/lib/clustering";

/**
 * POST /api/agent/tools/propose_box_structure
 *
 * Real implementation: pulls the workspace's note embeddings, L2-normalizes
 * them, and runs spherical k-means (kmeans++) across a small k range, picking
 * the k with the best silhouette score. Each resulting cluster is labelled
 * via a tiny TF-IDF over its member titles, and the response surfaces the proposed
 * regrouping alongside how the cluster's members are currently distributed
 * across boxes — enough context for the UI to render a meaningful diff
 * without making any destructive changes.
 *
 * Notes without embeddings are excluded from clustering (but counted in
 * `n_skipped_no_embedding`). Workspaces with <6 notes skip clustering
 * entirely. Results are deterministic: the RNG is seeded from
 * `workspaceId`, so repeated calls produce identical proposals.
 *
 * Body: { workspace_scope?: "all"|"box", box_id? }
 */

// Upper bound on notes considered per call. Cheap insurance against a
// pathologically large workspace exhausting memory on the Next.js server.
const MAX_NOTES = 2000;

// Inline, deliberately small stop-word list used by the TF-IDF labeller.
const STOPWORDS = new Set<string>([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for",
  "with", "as", "is", "it", "its", "at", "by", "from", "this", "that",
  "these", "those", "i", "you", "we", "they", "he", "she", "my", "your",
  "our", "their", "be", "was", "were", "will", "would", "can", "could",
  "should", "are", "am", "been", "being", "do", "does", "did", "have",
  "has", "had", "if", "then", "than", "so", "not", "no", "yes", "into",
  "about", "up", "down", "out", "over", "under", "also", "just", "very",
  "more", "most", "some", "any", "all", "both", "each", "other", "new",
]);

interface Body {
  workspace_scope?: string;
  box_id?: string;
}

type NoteRow = {
  id: string;
  box_id: string | null;
  title: string | null;
  note_embeddings:
    | { embedding: string | null }
    | { embedding: string | null }[]
    | null;
};

interface PreparedNote {
  id: string;
  boxId: string | null;
  title: string;
  vector: number[];
}

/** Parse the PostgREST-serialized vector string, e.g. "[0.1,0.2,...]". */
function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s.startsWith("[") || !s.endsWith("]")) return null;
  try {
    const parsed: unknown = JSON.parse(s);
    if (!Array.isArray(parsed)) return null;
    const out = new Array<number>(parsed.length);
    for (let i = 0; i < parsed.length; i++) {
      const v = parsed[i];
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      out[i] = v;
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Pull the embedding field from the joined PostgREST shape (object or array). */
function extractEmbeddingRaw(
  rel: NoteRow["note_embeddings"]
): string | null {
  if (rel === null || rel === undefined) return null;
  if (Array.isArray(rel)) {
    return rel.length > 0 ? rel[0]?.embedding ?? null : null;
  }
  return rel.embedding ?? null;
}

/** Deterministic shuffle (Fisher–Yates) used when capping N. */
function sampleDeterministic<T>(arr: T[], n: number, seed: number): T[] {
  if (arr.length <= n) return arr;
  const copy = arr.slice();
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, n);
}

/** Tokenize a title for TF-IDF: lowercase, word-split, drop short/stop. */
function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Derive a 3-token cluster label via TF-IDF over note titles.
 *
 * TF = frequency of token within the cluster's tokens.
 * IDF = log(K / df) where df = number of clusters containing the token.
 * Picking top-3 by tf*idf emphasises terms that are both common within
 * the cluster AND distinctive across clusters — a decent proxy for a
 * human-readable cluster name.
 */
function labelClusters(
  clusterTokens: string[][]
): string[] {
  const K = clusterTokens.length;
  // Document frequency across clusters.
  const df = new Map<string, number>();
  for (const tokens of clusterTokens) {
    const seen = new Set(tokens);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const labels: string[] = [];
  for (const tokens of clusterTokens) {
    if (tokens.length === 0) {
      labels.push("untitled group");
      continue;
    }
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const scored: Array<{ token: string; score: number }> = [];
    const total = tokens.length;
    for (const [token, freq] of tf) {
      const dfi = df.get(token) ?? 1;
      // log(K / df) — clamp to >=1 so we never score 0 when df == K.
      const idf = Math.log((1 + K) / (1 + dfi)) + 1;
      scored.push({ token, score: (freq / total) * idf });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3).map((x) => x.token);
    labels.push(top.length > 0 ? top.join(" · ") : "untitled group");
  }
  return labels;
}

export async function POST(request: NextRequest) {
  const auth = verifyAgentRequest(request);
  if (!auth.ok) {
    switch (auth.failure.kind) {
      case "feature_disabled":
        return apiError("feature_disabled", "Workspace Operator is not enabled", 404);
      case "missing_secret":
        return apiError("server_misconfigured", "Shared secret is not configured", 500);
      case "invalid_secret":
        return apiError("unauthorized", "Invalid shared secret", 401);
      case "missing_envelope":
        return apiError(
          "bad_request",
          `Missing required header: ${auth.failure.field}`,
          400
        );
      case "invalid_envelope":
        return apiError(
          "bad_request",
          `Invalid ${auth.failure.field}: ${auth.failure.reason}`,
          400
        );
    }
  }
  const { ctx } = auth;

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // Empty / invalid body is fine — all fields are optional.
    body = {};
  }

  const scope = body.workspace_scope ?? "all";
  if (scope !== "all" && scope !== "box") {
    return apiError(
      "bad_request",
      "workspace_scope must be one of: all, box",
      400
    );
  }
  if (scope === "box" && (!body.box_id || typeof body.box_id !== "string")) {
    return apiError(
      "bad_request",
      "box_id is required when workspace_scope='box'",
      400
    );
  }

  const admin = createAdminClient();

  try {
    // ── Current box structure (kept for UI back-compat). ──────────────
    let boxQuery = admin
      .from("boxes")
      .select("id, name")
      .eq("workspace_id", ctx.workspaceId)
      .limit(500);
    if (scope === "box" && body.box_id) {
      boxQuery = boxQuery.eq("id", body.box_id);
    }
    const { data: boxes, error: boxErr } = await boxQuery;
    if (boxErr) throw boxErr;
    const boxRows = (boxes ?? []) as { id: string; name: string }[];
    const boxNameById = new Map<string, string>();
    for (const b of boxRows) boxNameById.set(b.id, b.name);

    // Note counts per box — one aggregated query beats N roundtrips.
    const { data: countRows, error: countErr } = await admin
      .from("notes")
      .select("box_id")
      .eq("workspace_id", ctx.workspaceId)
      .limit(5000);
    if (countErr) throw countErr;
    const countsByBox = new Map<string, number>();
    for (const row of (countRows ?? []) as { box_id: string | null }[]) {
      if (!row.box_id) continue;
      countsByBox.set(row.box_id, (countsByBox.get(row.box_id) ?? 0) + 1);
    }
    const currentStructure: Array<{
      box_id: string;
      name: string;
      note_count: number;
    }> = boxRows.map((b) => ({
      box_id: b.id,
      name: b.name,
      note_count: countsByBox.get(b.id) ?? 0,
    }));

    // ── Pull notes + embeddings for clustering. ───────────────────────
    let notesQuery = admin
      .from("notes")
      .select("id, box_id, title, note_embeddings(embedding)")
      .eq("workspace_id", ctx.workspaceId)
      .limit(MAX_NOTES);
    if (scope === "box" && body.box_id) {
      notesQuery = notesQuery.eq("box_id", body.box_id);
    }
    const { data: noteRows, error: notesErr } = await notesQuery;
    if (notesErr) throw notesErr;
    const rawRows = (noteRows ?? []) as NoteRow[];

    const prepared: PreparedNote[] = [];
    let skippedNoEmbedding = 0;
    for (const row of rawRows) {
      const raw = extractEmbeddingRaw(row.note_embeddings);
      const parsed = parseEmbedding(raw);
      if (!parsed) {
        skippedNoEmbedding++;
        continue;
      }
      prepared.push({
        id: row.id,
        boxId: row.box_id,
        title: (row.title ?? "").trim(),
        vector: l2_normalize(parsed),
      });
    }

    const seed = seedFromString(ctx.workspaceId);

    // ── Sanity branches: no embeddings / too few notes. ────────────────
    if (prepared.length === 0) {
      return apiOk({
        current_structure: currentStructure,
        proposed_reorganization: [],
        summary:
          "No embeddings found for this workspace. Ensure notes have been indexed.",
        params: {
          n_notes: 0,
          n_skipped_no_embedding: skippedNoEmbedding,
          k: 0,
          silhouette: 0,
        },
      });
    }
    if (prepared.length < 6) {
      return apiOk({
        current_structure: currentStructure,
        proposed_reorganization: [],
        summary: `Too few notes to cluster (${prepared.length} with embeddings; need at least 6).`,
        params: {
          n_notes: prepared.length,
          n_skipped_no_embedding: skippedNoEmbedding,
          k: 0,
          silhouette: 0,
        },
      });
    }

    // Cap to MAX_NOTES by deterministic sample (seeded by workspace).
    const clusteringSet =
      prepared.length > MAX_NOTES
        ? sampleDeterministic(prepared, MAX_NOTES, seed)
        : prepared;
    const X = clusteringSet.map((n) => n.vector);

    // ── Choose k and run k-means. ─────────────────────────────────────
    const n = clusteringSet.length;
    const kUpper = Math.max(2, Math.min(10, Math.floor(Math.sqrt(n / 2))));
    const kRange: number[] = [];
    for (let k = 2; k <= kUpper; k++) kRange.push(k);

    const best = best_k_silhouette(X, kRange, {
      seed,
      maxIter: 50,
      silhouetteSampleSize: 500,
    });

    const { k, silhouette, labels, centroids } = best;

    // ── Group members by cluster. ─────────────────────────────────────
    const members: PreparedNote[][] = Array.from({ length: k }, () => []);
    for (let i = 0; i < clusteringSet.length; i++) {
      const lbl = labels[i];
      if (lbl >= 0 && lbl < k) members[lbl].push(clusteringSet[i]);
    }

    // Representative titles: top-3 by cosine similarity to centroid.
    const reprTitlesPerCluster: string[][] = [];
    for (let c = 0; c < k; c++) {
      const centroid = centroids[c] ?? [];
      const rows = members[c];
      const scored = rows.map((row) => {
        let sim = 0;
        const L = Math.min(centroid.length, row.vector.length);
        for (let d = 0; d < L; d++) sim += centroid[d] * row.vector[d];
        return { title: row.title, sim };
      });
      scored.sort((a, b) => b.sim - a.sim);
      reprTitlesPerCluster.push(
        scored
          .slice(0, 3)
          .map((s) => s.title)
          .filter((t) => t.length > 0)
      );
    }

    // ── Cluster name via TF-IDF on titles. ────────────────────────────
    const tokensPerCluster = members.map((rows) =>
      rows.flatMap((r) => tokenize(r.title))
    );
    const clusterLabels = labelClusters(tokensPerCluster);

    // ── Build proposal entries. ───────────────────────────────────────
    const proposed = members.map((rows, idx) => {
      const noteIds = rows.map((r) => r.id);
      const firstTitles = rows
        .map((r) => r.title)
        .filter((t) => t.length > 0)
        .slice(0, 8);
      const boxCounts = new Map<string, number>();
      for (const r of rows) {
        if (!r.boxId) continue;
        boxCounts.set(r.boxId, (boxCounts.get(r.boxId) ?? 0) + 1);
      }
      const currentBoxes = Array.from(boxCounts.entries())
        .map(([boxId, count]) => ({
          box_id: boxId,
          name: boxNameById.get(boxId) ?? "(unknown box)",
          count,
        }))
        .sort((a, b) => b.count - a.count);

      const distinctBoxCount = currentBoxes.length;
      const label = clusterLabels[idx];
      const reprText =
        reprTitlesPerCluster[idx].length > 0
          ? reprTitlesPerCluster[idx].slice(0, 2).join('", "')
          : "";
      const rationale =
        `Cluster of ${rows.length} note(s) currently spread across ` +
        `${distinctBoxCount} box(es); representative titles include "${reprText}". ` +
        `Proposed label "${label}" derived from TF-IDF over cluster titles.`;

      return {
        kind: "cluster" as const,
        cluster_label: label,
        note_ids: noteIds,
        note_titles: firstTitles,
        representative_titles: reprTitlesPerCluster[idx],
        rationale,
        current_boxes: currentBoxes,
      };
    });

    // ── Summary string. ───────────────────────────────────────────────
    const largest = proposed.reduce(
      (m, c) => Math.max(m, c.note_ids.length),
      0
    );
    const silhouetteDisplay = Number.isFinite(silhouette)
      ? silhouette.toFixed(3)
      : "n/a";
    const summary = `Clustered ${n} notes into ${k} groups with silhouette score ${silhouetteDisplay}. Largest cluster holds ${largest} notes.`;

    return apiOk({
      current_structure: currentStructure,
      proposed_reorganization: proposed,
      summary,
      params: {
        n_notes: n,
        n_skipped_no_embedding: skippedNoEmbedding,
        k,
        silhouette: Number.isFinite(silhouette) ? silhouette : 0,
      },
    });
  } catch (err) {
    console.error("[agent_tools_propose_box_structure] failed", err);
    return E_INTERNAL();
  }
}
