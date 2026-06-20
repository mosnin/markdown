import { NextResponse } from "next/server";

import { getRequestContext } from "@/server/auth/get_request_context";

// ─── Simple streaming chat via OpenRouter ────────────────────────────────────
//
// A direct, browser-facing chat that bypasses the heavier operator system
// (no Modal sandbox, no agent loop, no plan/approval). The user's messages are
// proxied to OpenRouter's OpenAI-compatible endpoint and the response is
// streamed back as plain-text deltas. The API key never leaves the server.
//
// Config (env):
//   OPENROUTER_API_KEY  — required; the chat returns 503 until it's set.
//   OPENROUTER_MODEL    — optional; defaults to a DeepSeek chat model. Set this
//                         to the exact OpenRouter slug you want (e.g. a v4 id).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-chat";
const MAX_MESSAGES = 40;

type ChatRole = "system" | "user" | "assistant";
interface ChatMessage {
  role: ChatRole;
  content: string;
}

const SYSTEM_PROMPT =
  "You are Poggle's assistant — a concise, friendly helper for researching, " +
  "writing, and organizing notes. Use Markdown. Be direct and useful.";

export async function POST(req: Request) {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Chat isn't configured yet — set OPENROUTER_API_KEY." },
      { status: 503 },
    );
  }

  let payload: { messages?: ChatMessage[] };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const incoming = Array.isArray(payload.messages) ? payload.messages : [];
  const messages: ChatMessage[] = incoming
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
    .slice(-MAX_MESSAGES);

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided." }, { status: 400 });
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://www.poggle.xyz",
        "X-Title": "Poggle",
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      }),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach OpenRouter." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `OpenRouter error (${upstream.status}). ${detail.slice(0, 300)}` },
      { status: 502 },
    );
  }

  // Parse OpenRouter's SSE stream → emit just the text deltas as plain text.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buffer = "";
      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const raw of lines) {
              const line = raw.trim();
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (data === "[DONE]") {
                controller.close();
                return;
              }
              try {
                const json = JSON.parse(data);
                const delta: unknown = json?.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta.length > 0) {
                  controller.enqueue(encoder.encode(delta));
                }
              } catch {
                // partial/keep-alive line — ignore
              }
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      })();
    },
    cancel() {
      void reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
