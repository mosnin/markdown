type PendingRequest = {
  resolve: (vectors: number[][]) => void;
  reject: (reason: unknown) => void;
};

export class EmbeddingClient {
  private static instance: EmbeddingClient | null = null;

  private worker: Worker | null = null;
  private pending: Map<string, PendingRequest> = new Map();
  private ready = false;

  private constructor() {}

  static getInstance(): EmbeddingClient {
    if (!EmbeddingClient.instance) {
      EmbeddingClient.instance = new EmbeddingClient();
    }
    return EmbeddingClient.instance;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const w = new Worker(new URL("./embedding_worker", import.meta.url), {
      type: "module",
    });

    w.onmessage = (event: MessageEvent) => {
      const msg = event.data;

      if (msg.type === "pong") {
        this.ready = true;
        return;
      }

      if (msg.type === "result") {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          pending.resolve(msg.vectors);
        }
        return;
      }

      if (msg.type === "error") {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          pending.reject(new Error(msg.message));
        }
      }
    };

    w.onerror = (event: ErrorEvent) => {
      const message = event.message ?? "Worker error";
      for (const { reject } of this.pending.values()) {
        reject(new Error(message));
      }
      this.pending.clear();
      this.worker = null;
      this.ready = false;
      EmbeddingClient.instance = null;
    };

    w.postMessage({ type: "ping" });

    this.worker = w;
    return w;
  }

  embed(texts: string[]): Promise<number[][]> {
    if (typeof Worker === "undefined") {
      return Promise.reject(new Error("WebWorkers are not available in this environment"));
    }

    const worker = this.ensureWorker();
    const id = crypto.randomUUID();

    return new Promise<number[][]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: "embed", id, texts });
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pending.clear();
    this.ready = false;
    EmbeddingClient.instance = null;
  }
}

export function getEmbeddingClient(): EmbeddingClient | null {
  if (typeof Worker === "undefined") return null;
  return EmbeddingClient.getInstance();
}
