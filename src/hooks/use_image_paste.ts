"use client";

import { useEffect, useRef, useState } from "react";
import {
  uploadNoteImageAction,
  describeImageAction,
} from "@/app/app/notes/image_actions";

/**
 * Listens for paste events containing image data, uploads them to Supabase
 * Storage via `uploadNoteImageAction`, then fetches an AI description via
 * `describeImageAction`. Calls `onImageInserted(url, description)` on success.
 */
export function useImagePaste(
  noteId: string,
  onImageInserted: (url: string, description: string) => void
): { isUploading: boolean; error: string | null } {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stabilize the callback so the paste listener isn't re-registered every
  // time the parent re-renders with a fresh inline callback.
  const onImageInsertedRef = useRef(onImageInserted);
  onImageInsertedRef.current = onImageInserted;

  useEffect(() => {
    let cancelled = false;

    async function handlePaste(event: ClipboardEvent) {
      const items = event.clipboardData?.items;
      if (!items) return;

      let imageItem: DataTransferItem | null = null;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          imageItem = item;
          break;
        }
      }

      if (!imageItem) return;

      const file = imageItem.getAsFile();
      if (!file) return;

      // Prevent default paste of the image blob into the editor text.
      event.preventDefault();

      setIsUploading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append("image", file);

        const uploadResult = await uploadNoteImageAction(noteId, formData);
        if (cancelled) return;

        if (!uploadResult.ok) {
          setError(uploadResult.error);
          setIsUploading(false);
          return;
        }

        const { url } = uploadResult;

        const describeResult = await describeImageAction(url, noteId);
        if (cancelled) return;

        const description = describeResult.ok ? describeResult.description : "";
        onImageInsertedRef.current(url, description);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to upload image"
          );
        }
      } finally {
        if (!cancelled) {
          setIsUploading(false);
        }
      }
    }

    document.addEventListener("paste", handlePaste);
    return () => {
      cancelled = true;
      document.removeEventListener("paste", handlePaste);
    };
  }, [noteId]);

  return { isUploading, error };
}
