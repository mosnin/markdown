"use client";

// Web Speech API types not in TS lib by default
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
declare class SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognition, ev: Event) => void) | null;
  start(): void;
  stop(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: typeof SpeechRecognition;
    webkitSpeechRecognition?: typeof SpeechRecognition;
  }
}

import { useCallback, useRef, useState } from "react";

export type VoiceState = "idle" | "listening" | "unsupported";

export function useVoiceCapture(onTranscript: (text: string) => void) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [state, setState] = useState<VoiceState>(() => {
    // SSR guard: window not available during server render
    if (typeof window === "undefined") return "idle";
    return "SpeechRecognition" in window || "webkitSpeechRecognition" in window
      ? "idle"
      : "unsupported";
  });

  const start = useCallback(() => {
    if (state === "unsupported") return;
    const SpeechRecognitionImpl =
      window.webkitSpeechRecognition ?? window.SpeechRecognition;
    if (!SpeechRecognitionImpl) return;

    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .filter((r) => r.isFinal)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) onTranscript(transcript);
    };

    recognition.onend = () => setState("idle");
    recognition.onerror = () => setState("idle");

    recognitionRef.current = recognition;
    recognition.start();
    setState("listening");
  }, [state, onTranscript]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setState("idle");
  }, []);

  const toggle = useCallback(() => {
    if (state === "listening") stop();
    else start();
  }, [state, start, stop]);

  return { state, toggle };
}
