"use client";

import { useRef, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import {
  uploadNoteImageAction,
  describeImageAction,
} from "@/app/app/notes/image_actions";

interface ImageAttachmentProps {
  noteId: string;
  onInserted: (url: string, description: string) => void;
}

/**
 * A small toolbar button that opens a file picker for images.
 * On selection, it uploads the image to Supabase Storage and requests
 * a GPT-4o vision description, then calls `onInserted(url, description)`.
 */
export function ImageAttachment({ noteId, onInserted }: ImageAttachmentProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const uploadResult = await uploadNoteImageAction(noteId, formData);

      if (!uploadResult.ok) {
        setError(uploadResult.error);
        setIsUploading(false);
        // Reset the input so the same file can be selected again.
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      const { url } = uploadResult;

      const describeResult = await describeImageAction(url, noteId);
      const description = describeResult.ok ? describeResult.description : "";

      onInserted(url, description);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to upload image"
      );
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="relative inline-flex items-center">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Attach image"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        title="Attach image"
        className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {isUploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ImageIcon className="h-3.5 w-3.5" />
        )}
        <span>Attach image</span>
      </button>
      {error && (
        <span className="ml-2 text-xs text-destructive" title={error}>
          {error.length > 60 ? `${error.slice(0, 57)}…` : error}
        </span>
      )}
    </div>
  );
}
