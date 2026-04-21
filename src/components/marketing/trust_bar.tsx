import { ShieldCheck, Lock, Download } from "lucide-react";

const items = [
  {
    icon: ShieldCheck,
    label: "Your notes never train AI models",
  },
  {
    icon: Lock,
    label: "Encrypted at rest & in transit",
  },
  {
    icon: Download,
    label: "Export everything as Markdown, anytime",
  },
] as const;

export function TrustBar() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="flex items-center gap-1.5 sm:contents">
            {index > 0 && (
              <span
                aria-hidden="true"
                className="hidden sm:mx-3 sm:block text-muted-foreground/30 select-none"
              >
                ·
              </span>
            )}
            <div className="flex items-center gap-1.5">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              <span className="text-xs text-muted-foreground">{item.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
