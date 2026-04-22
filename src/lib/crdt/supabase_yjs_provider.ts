import * as Y from "yjs";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

const MAX_UPDATE_BYTES = 65536;

export class SupabaseYjsProvider {
  readonly doc: Y.Doc;
  readonly channelName: string;
  synced: boolean = false;

  private supabase: SupabaseClient;
  private channel: RealtimeChannel | null = null;

  constructor(supabase: SupabaseClient, channelName: string, doc: Y.Doc) {
    this.supabase = supabase;
    this.channelName = channelName;
    this.doc = doc;
  }

  connect(): void {
    const channel = this.supabase.channel(this.channelName);
    this.channel = channel;

    channel.on(
      "broadcast",
      { event: "yjs-update" },
      ({ payload }: { payload: { update: string } }) => {
        const update = Uint8Array.from(atob(payload.update), (c) =>
          c.charCodeAt(0)
        );
        Y.applyUpdate(this.doc, update, this);
      }
    );

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") this.synced = true;
    });

    this.doc.on("update", this.handleUpdate);
  }

  disconnect(): void {
    this.doc.off("update", this.handleUpdate);
    if (this.channel) {
      void this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.synced = false;
  }

  // Arrow function so the same reference is used for on/off.
  private handleUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return;

    if (update.byteLength > MAX_UPDATE_BYTES) {
      console.warn(
        `[SupabaseYjsProvider] update too large to broadcast (${update.byteLength} bytes), skipping`
      );
      return;
    }

    const base64 = btoa(String.fromCharCode(...new Uint8Array(update)));
    void this.channel?.send({
      type: "broadcast",
      event: "yjs-update",
      payload: { update: base64 },
    });
  };
}
