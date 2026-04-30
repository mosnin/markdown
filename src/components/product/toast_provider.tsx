"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

/**
 * Toast region anchored to the bottom-right.
 *
 * Each toast is a flat card-like surface — hairline border, bg-card, soft
 * shadow-lg, max-w-sm, 13px text — with a status icon driven by variant.
 * Stays for 3.5s, can be dismissed manually.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const icons: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />,
    error: <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />,
    info: <Info className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />,
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
          aria-live="polite"
          aria-label="Notifications"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex min-w-64 max-w-sm items-start gap-3 rounded-lg border border-border bg-card px-3.5 py-3 shadow-lg",
                "animate-in slide-in-from-bottom-2 fade-in duration-200"
              )}
              role="status"
            >
              <div className="mt-0.5">{icons[t.type]}</div>
              <span className="flex-1 text-[13px] leading-snug text-foreground">
                {t.message}
              </span>
              <button
                onClick={() => dismiss(t.id)}
                className={cn(
                  "ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors",
                  "hover:bg-accent hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                )}
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
