import { Calendar, Clock, Hash, Tag, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelSection } from "@/components/product/panel_section";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MetadataItem {
  label: string;
  value: string;
}

interface MetadataPanelStubProps {
  /** Note or entity title */
  title?: string;
  kind?: "note" | "guide" | "bundle" | "box";
  tags?: string[];
  metadata?: MetadataItem[];
  className?: string;
}

// ─── Small metadata row ──────────────────────────────────────────────────────

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
          {label}
        </p>
        <p className="truncate text-xs text-foreground/80">{value}</p>
      </div>
    </div>
  );
}

/**
 * Right-panel metadata view for a note, guide, bundle, or box.
 * Displays structured metadata without querying real data.
 * Replace placeholder values with server data in a later prompt.
 */
export function MetadataPanelStub({
  title = "Untitled",
  kind = "note",
  tags = [],
  metadata = [],
  className,
}: MetadataPanelStubProps) {
  const defaultMeta: MetadataItem[] = [
    { label: "Created", value: "—" },
    { label: "Updated", value: "—" },
    { label: "Author", value: "—" },
    ...metadata,
  ];

  const metaIcons: Record<string, React.ElementType> = {
    Created: Calendar,
    Updated: Clock,
    Author: User,
    ID: Hash,
  };

  return (
    <div className={cn("flex flex-col gap-0 overflow-y-auto", className)}>
      {/* Entity identity */}
      <div className="border-b border-border px-4 py-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
          {kind}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm font-medium text-foreground">
          {title}
        </p>
      </div>

      {/* Tags */}
      <PanelSection title="Tags" noSeparator>
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="text-xs font-normal"
              >
                <Tag className="mr-1 h-2.5 w-2.5" />
                {tag}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/60">No tags</p>
        )}
      </PanelSection>

      <Separator />

      {/* Metadata fields */}
      <PanelSection title="Details" noSeparator>
        <div className="flex flex-col">
          {defaultMeta.map((item) => (
            <MetaRow
              key={item.label}
              icon={metaIcons[item.label] ?? Hash}
              label={item.label}
              value={item.value}
            />
          ))}
        </div>
      </PanelSection>
    </div>
  );
}

/**
 * Loading state for the metadata panel.
 */
export function MetadataPanelSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
      <Separator className="my-1" />
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          // skeleton row, index key is safe
          <div key={i} className="flex gap-2">
            <Skeleton className="h-3.5 w-3.5 rounded" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-2 w-12" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
