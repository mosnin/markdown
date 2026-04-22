import { createStore, get, set, del, keys } from 'idb-keyval';

// One store instance shared across all calls in this module.
const store = createStore('note-embeddings', 'vectors');

function assertIndexedDB(): void {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB not available');
  }
}

export async function storeVector(noteId: string, vector: number[]): Promise<void> {
  assertIndexedDB();
  try {
    await set(noteId, new Float32Array(vector), store);
  } catch (err) {
    console.error('[note_vector_store] storeVector failed', err);
    throw err;
  }
}

export async function deleteVector(noteId: string): Promise<void> {
  assertIndexedDB();
  try {
    await del(noteId, store);
  } catch (err) {
    console.error('[note_vector_store] deleteVector failed', err);
    throw err;
  }
}

export async function getIndexedNoteIds(): Promise<string[]> {
  assertIndexedDB();
  try {
    return (await keys(store)) as string[];
  } catch (err) {
    console.error('[note_vector_store] getIndexedNoteIds failed', err);
    throw err;
  }
}

// Dot product equals cosine similarity because vectors are L2-normalised by the embedding worker.
function dotProduct(a: Float32Array, b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

export async function queryTopK(
  queryVector: number[],
  k: number,
  workspaceNoteIds?: string[],
): Promise<Array<{ noteId: string; score: number }>> {
  assertIndexedDB();
  try {
    const allKeys = (await keys(store)) as string[];

    const candidateKeys =
      workspaceNoteIds !== undefined
        ? (() => {
            const allowed = new Set(workspaceNoteIds);
            return allKeys.filter((id) => allowed.has(id));
          })()
        : allKeys;

    const scored: Array<{ noteId: string; score: number }> = [];

    for (const noteId of candidateKeys) {
      const stored = await get<Float32Array>(noteId, store);
      if (stored == null) continue;
      scored.push({ noteId, score: dotProduct(stored, queryVector) });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  } catch (err) {
    console.error('[note_vector_store] queryTopK failed', err);
    throw err;
  }
}
