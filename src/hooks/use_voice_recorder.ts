"use client";

import { useCallback, useRef, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VoiceRecorderSupported {
  supported: true;
  isRecording: boolean;
  isTranscribing: boolean;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
}

export interface VoiceRecorderUnsupported {
  supported: false;
}

export type UseVoiceRecorderResult =
  | VoiceRecorderSupported
  | VoiceRecorderUnsupported;

// ── Preferred MIME type ───────────────────────────────────────────────────────

function getSupportedMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useVoiceRecorder
 *
 * Provides start/stop recording and automatic transcription via
 * POST /api/voice/transcribe. Returns `{ supported: false }` when
 * MediaRecorder is not available in the current environment.
 *
 * @param noteId — the note the transcription will be inserted into
 */
export function useVoiceRecorder(noteId: string): UseVoiceRecorderResult {
  // Feature-detect on first render (SSR-safe: typeof checks run on client).
  if (
    typeof window === "undefined" ||
    typeof MediaRecorder === "undefined" ||
    typeof navigator === "undefined" ||
    !navigator.mediaDevices
  ) {
    return { supported: false };
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useVoiceRecorderInternal(noteId);
}

function useVoiceRecorderInternal(noteId: string): VoiceRecorderSupported {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    setError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied. Please allow microphone access and try again."
          : "Could not access microphone. Please check your device settings.";
      setError(msg);
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = getSupportedMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorderRef.current = recorder;
    recorder.start(100); // collect data in 100ms chunks
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return null;
    }

    // Collect final audio data as a Promise
    const audioBlob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";
        resolve(new Blob(chunksRef.current, { type: mimeType }));
      };
      recorder.stop();
    });

    // Stop all tracks to release the microphone indicator
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);

    // ── Transcribe ────────────────────────────────────────────────────────
    setIsTranscribing(true);
    setError(null);

    try {
      const formData = new FormData();
      const ext = audioBlob.type.includes("ogg") ? "ogg" : "webm";
      formData.append("audio", audioBlob, `recording.${ext}`);
      formData.append("note_id", noteId);

      const resp = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: formData,
      });

      const json = (await resp.json()) as
        | { ok: true; text: string }
        | { ok: false; error: string };

      if (!json.ok) {
        setError(json.error ?? "Transcription failed");
        return null;
      }

      return json.text;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to transcribe audio";
      setError(msg);
      return null;
    } finally {
      setIsTranscribing(false);
    }
  }, [noteId]);

  return {
    supported: true,
    isRecording,
    isTranscribing,
    error,
    startRecording,
    stopRecording,
  };
}
