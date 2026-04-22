import { pipeline } from "@huggingface/transformers";

// Intentionally loosely typed: the specific FeatureExtractionPipeline
// generic from @huggingface/transformers produces a union that exceeds
// the TS complexity limit. The runtime surface we use is stable: call
// it as a function with (text, options) → { data: Float32Array }.
type Extractor = (
  text: string,
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: Float32Array }>;

let cachedPipeline: Extractor | null = null;

async function getPipeline(): Promise<Extractor> {
  if (!cachedPipeline) {
    const p = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    cachedPipeline = p as unknown as Extractor;
  }
  return cachedPipeline;
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  if (msg.type === "ping") {
    self.postMessage({ type: "pong" });
    return;
  }

  if (msg.type === "embed") {
    const { id, texts } = msg as { type: "embed"; id: string; texts: string[] };
    try {
      const extractor = await getPipeline();
      const vectors: number[][] = [];

      for (const text of texts) {
        const output = await extractor(text, { pooling: "mean", normalize: true });
        vectors.push(Array.from(output.data));
      }

      self.postMessage({ type: "result", id, vectors });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: "error", id, message });
    }
  }
};
