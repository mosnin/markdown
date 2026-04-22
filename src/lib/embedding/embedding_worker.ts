import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

let cachedPipeline: FeatureExtractionPipeline | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!cachedPipeline) {
    cachedPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
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
        const data: Float32Array = output.data;
        vectors.push(Array.from(data));
      }

      self.postMessage({ type: "result", id, vectors });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: "error", id, message });
    }
  }
};
