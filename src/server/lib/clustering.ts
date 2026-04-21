/**
 * Spherical k-means + silhouette scoring for semantic clustering of
 * L2-normalized embedding vectors.
 *
 * All functions here are pure: no I/O, no globals (other than a
 * deterministic seeded PRNG passed in). They operate on plain
 * `number[][]` matrices where each row is an embedding vector assumed
 * to already be unit-normalized. On unit vectors cosine similarity
 * equals dot product, so we can lean on fast dot products throughout.
 *
 * The module is intentionally dependency-free — the project ships
 * without an ML library, and a faithful k-means implementation is
 * small enough to write by hand (~150 lines including silhouette).
 */

// ─── PRNG ────────────────────────────────────────────────────────────────────

/**
 * Mulberry32 — a tiny, fast, 32-bit deterministic PRNG. Good enough for
 * seeding k-means++ on workspace-sized inputs. Seeded once per call so
 * repeated runs on the same workspace return identical clusters.
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function rng(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a UUID (or arbitrary string) to a 32-bit seed via FNV-1a. */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ─── Vector math ─────────────────────────────────────────────────────────────

/** In-place L2 normalize a vector. Returns the same array. */
export function l2_normalize(v: number[]): number[] {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm === 0 || !Number.isFinite(norm)) return v;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/** Dot product (== cosine similarity for unit-length inputs). */
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Cosine distance in [0, 2] — assumes both vectors already unit length. */
function cosineDistance(a: number[], b: number[]): number {
  return 1 - dot(a, b);
}

// ─── k-means++ initialization ───────────────────────────────────────────────

function kmeansPlusPlusInit(
  X: number[][],
  k: number,
  rng: () => number
): number[][] {
  const n = X.length;
  const dim = X[0].length;
  const centroids: number[][] = [];
  // First centroid chosen uniformly at random.
  const firstIdx = Math.min(n - 1, Math.floor(rng() * n));
  centroids.push(X[firstIdx].slice());

  // Distance² from each point to the nearest chosen centroid so far.
  const dist2 = new Array<number>(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const d = cosineDistance(X[i], centroids[0]);
    dist2[i] = d * d;
  }

  while (centroids.length < k) {
    let total = 0;
    for (let i = 0; i < n; i++) total += dist2[i];
    if (total <= 0 || !Number.isFinite(total)) {
      // All points coincide with a centroid; just copy a random one.
      const idx = Math.min(n - 1, Math.floor(rng() * n));
      const c = X[idx].slice();
      centroids.push(c);
    } else {
      const target = rng() * total;
      let cum = 0;
      let chosen = n - 1;
      for (let i = 0; i < n; i++) {
        cum += dist2[i];
        if (cum >= target) {
          chosen = i;
          break;
        }
      }
      centroids.push(X[chosen].slice());
      // Update dist² with min against the new centroid.
      const c = centroids[centroids.length - 1];
      for (let i = 0; i < n; i++) {
        const d = cosineDistance(X[i], c);
        const d2 = d * d;
        if (d2 < dist2[i]) dist2[i] = d2;
      }
    }
    // Sanity: guarantee dim stays consistent.
    if (centroids[centroids.length - 1].length !== dim) {
      throw new Error("kmeans++ centroid dimension mismatch");
    }
  }
  return centroids;
}

// ─── Spherical k-means ──────────────────────────────────────────────────────

export interface KMeansResult {
  labels: number[];      // one cluster id per input point, 0..k-1
  centroids: number[][]; // k unit-length centroids
  inertia: number;       // sum of (1 - cos_sim) to assigned centroid
  iterations: number;
}

export interface KMeansOptions {
  seed?: number;
  maxIter?: number;
  tol?: number; // centroid movement threshold (L2 norm of delta)
}

/**
 * Spherical k-means on L2-normalized vectors. Centroids are re-normalized
 * after each averaging step, so assignments use cosine similarity
 * throughout. Runs at most `maxIter` iterations or until centroid
 * movement drops below `tol`.
 */
export function spherical_kmeans(
  X: number[][],
  k: number,
  opts: KMeansOptions = {}
): KMeansResult {
  const n = X.length;
  if (n === 0) {
    return { labels: [], centroids: [], inertia: 0, iterations: 0 };
  }
  const dim = X[0].length;
  const maxIter = opts.maxIter ?? 50;
  const tol = opts.tol ?? 1e-4;
  const rng = makeRng((opts.seed ?? 1) >>> 0);
  const kEff = Math.max(1, Math.min(k, n));

  let centroids = kmeansPlusPlusInit(X, kEff, rng);
  const labels = new Array<number>(n).fill(0);
  let iter = 0;

  for (; iter < maxIter; iter++) {
    // Assignment step — pick nearest centroid by cosine distance.
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bestLabel = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < kEff; c++) {
        const sim = dot(X[i], centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          bestLabel = c;
        }
      }
      if (labels[i] !== bestLabel) {
        labels[i] = bestLabel;
        changed = true;
      }
    }

    // Update step — mean of members, then re-normalize.
    const sums: number[][] = Array.from({ length: kEff }, () =>
      new Array<number>(dim).fill(0)
    );
    const counts = new Array<number>(kEff).fill(0);
    for (let i = 0; i < n; i++) {
      const lbl = labels[i];
      counts[lbl]++;
      const row = X[i];
      const target = sums[lbl];
      for (let d = 0; d < dim; d++) target[d] += row[d];
    }

    let movement = 0;
    const newCentroids: number[][] = [];
    for (let c = 0; c < kEff; c++) {
      if (counts[c] === 0) {
        // Empty cluster: re-seed from the point farthest from its own centroid.
        let worstIdx = 0;
        let worstSim = Infinity;
        for (let i = 0; i < n; i++) {
          const sim = dot(X[i], centroids[labels[i]]);
          if (sim < worstSim) {
            worstSim = sim;
            worstIdx = i;
          }
        }
        newCentroids.push(X[worstIdx].slice());
      } else {
        const inv = 1 / counts[c];
        const v = sums[c];
        for (let d = 0; d < dim; d++) v[d] *= inv;
        l2_normalize(v);
        newCentroids.push(v);
      }
      // Track L2 movement for convergence check.
      let m = 0;
      const oldC = centroids[c];
      const newC = newCentroids[c];
      for (let d = 0; d < dim; d++) {
        const diff = newC[d] - oldC[d];
        m += diff * diff;
      }
      movement += Math.sqrt(m);
    }

    centroids = newCentroids;
    if (!changed || movement < tol) {
      iter++;
      break;
    }
  }

  // Final inertia = sum of cosine distances to assigned centroid.
  let inertia = 0;
  for (let i = 0; i < n; i++) {
    inertia += cosineDistance(X[i], centroids[labels[i]]);
  }

  return { labels, centroids, inertia, iterations: iter };
}

// ─── Silhouette ─────────────────────────────────────────────────────────────

export interface SilhouetteOptions {
  sampleSize?: number; // if N > sampleSize, sample this many points
  seed?: number;
}

/**
 * Average cosine silhouette coefficient over the input. When N exceeds
 * `sampleSize`, computes silhouette on a deterministic sample for perf.
 * Returns NaN if there is only one cluster.
 */
export function silhouette_score(
  X: number[][],
  labels: number[],
  opts: SilhouetteOptions = {}
): number {
  const n = X.length;
  if (n !== labels.length) {
    throw new Error("silhouette_score: X and labels length mismatch");
  }
  const uniqueLabels = new Set(labels);
  if (uniqueLabels.size < 2) return Number.NaN;

  const sampleSize = opts.sampleSize ?? 500;
  const rng = makeRng((opts.seed ?? 7) >>> 0);

  // Deterministic sample indices when N is large.
  let sampleIdx: number[];
  if (n > sampleSize) {
    // Fisher–Yates partial shuffle to pick `sampleSize` distinct indices.
    const pool = Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < sampleSize; i++) {
      const j = i + Math.floor(rng() * (n - i));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    sampleIdx = pool.slice(0, sampleSize);
  } else {
    sampleIdx = Array.from({ length: n }, (_, i) => i);
  }

  // Index members per cluster for fast iteration.
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const arr = clusters.get(labels[i]);
    if (arr) arr.push(i);
    else clusters.set(labels[i], [i]);
  }

  let total = 0;
  let count = 0;
  for (const i of sampleIdx) {
    const own = labels[i];
    const ownMembers = clusters.get(own) ?? [];
    if (ownMembers.length <= 1) {
      // Silhouette convention: singleton clusters contribute 0.
      count++;
      continue;
    }
    // Mean intra-cluster distance (exclude self).
    let sumOwn = 0;
    for (const j of ownMembers) {
      if (j === i) continue;
      sumOwn += cosineDistance(X[i], X[j]);
    }
    const a_i = sumOwn / (ownMembers.length - 1);

    // Mean distance to the *nearest* other cluster.
    let b_i = Infinity;
    for (const [lbl, members] of clusters) {
      if (lbl === own) continue;
      let s = 0;
      for (const j of members) s += cosineDistance(X[i], X[j]);
      const mean = s / members.length;
      if (mean < b_i) b_i = mean;
    }

    const denom = Math.max(a_i, b_i);
    const s_i = denom === 0 ? 0 : (b_i - a_i) / denom;
    total += s_i;
    count++;
  }
  return count === 0 ? Number.NaN : total / count;
}

// ─── Best-k sweep ───────────────────────────────────────────────────────────

export interface BestKResult {
  k: number;
  silhouette: number;
  labels: number[];
  centroids: number[][];
  perK: Array<{ k: number; silhouette: number }>;
}

export interface BestKOptions {
  seed?: number;
  maxIter?: number;
  silhouetteSampleSize?: number;
}

/**
 * Sweep k across `kRange`, run spherical k-means for each, score with
 * silhouette, and return the best (highest silhouette, ties broken by
 * the smallest k). If `kRange` is empty or contains only invalid values,
 * falls back to k=2.
 */
export function best_k_silhouette(
  X: number[][],
  kRange: number[],
  opts: BestKOptions = {}
): BestKResult {
  const validRange = kRange.filter(
    (k) => Number.isInteger(k) && k >= 2 && k <= X.length
  );
  const effective = validRange.length > 0 ? validRange : [2];
  const seed = (opts.seed ?? 1) >>> 0;

  let best: BestKResult | null = null;
  const perK: Array<{ k: number; silhouette: number }> = [];

  for (const k of effective) {
    const res = spherical_kmeans(X, k, {
      seed,
      maxIter: opts.maxIter ?? 50,
    });
    const s = silhouette_score(X, res.labels, {
      sampleSize: opts.silhouetteSampleSize ?? 500,
      seed,
    });
    perK.push({ k, silhouette: Number.isFinite(s) ? s : -1 });
    const sComparable = Number.isFinite(s) ? s : -Infinity;
    if (
      best === null ||
      sComparable > best.silhouette ||
      // Tie-break: prefer smaller k.
      (sComparable === best.silhouette && k < best.k)
    ) {
      best = {
        k,
        silhouette: sComparable,
        labels: res.labels,
        centroids: res.centroids,
        perK,
      };
    }
  }

  // `best` is guaranteed non-null because `effective` is non-empty.
  const chosen = best ?? {
    k: 2,
    silhouette: Number.NaN,
    labels: new Array<number>(X.length).fill(0),
    centroids: [],
    perK,
  };
  chosen.perK = perK;
  return chosen;
}
