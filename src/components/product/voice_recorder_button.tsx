"use client";

import { useCallback } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useVoiceRecorder } from "@/hooks/use_voice_recorder";

interface VoiceRecorderButtonProps {
  noteId: string;
  onTranscription: (text: string) => void;
}

/**
 * VoiceRecorderButton
 *
 * A small toolbar button that lets users record audio and have it
 * transcribed into the note editor via the Whisper API.
 *
 * - Idle: microphone icon
 * - Recording: red pulsing microphone-off icon (click to stop)
 * - Transcribing: spinner
 * - Error: inline error message beneath the button
 */
export function VoiceRecorderButton({
  noteId,
  onTranscription,
}: VoiceRecorderButtonProps) {
  const recorder = useVoiceRecorder(noteId);

  const handleClick = useCallback(async () => {
    if (!recorder.supported) return;

    if (recorder.isRecording) {
      const text = await recorder.stopRecording();
      if (text) {
        onTranscription(text);
      }
    } else {
      await recorder.startRecording();
    }
  }, [recorder, onTranscription]);

  // Browser doesn't support MediaRecorder — hide the button entirely.
  if (!recorder.supported) {
    return null;
  }

  const { isRecording, isTranscribing, error } = recorder;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isTranscribing}
        title={
          isTranscribing
            ? "Transcribing…"
            : isRecording
              ? "Stop recording"
              : "Record voice note"
        }
        className={[
          "flex items-center justify-center rounded p-1 transition-colors",
          "text-xs text-muted-foreground hover:text-foreground hover:bg-muted",
          isRecording
            ? "text-destructive hover:text-destructive hover:bg-destructive/10 animate-pulse"
            : "",
          isTranscribing
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={
          isTranscribing
            ? "Transcribing audio"
            : isRecording
              ? "Stop recording"
              : "Start voice recording"
        }
        aria-pressed={isRecording}
      >
        {isTranscribing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isRecording ? (
          <MicOff className="h-3.5 w-3.5" />
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
      </button>

      {error && (
        <p className="max-w-[180px] text-center text-[10px] leading-tight text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
