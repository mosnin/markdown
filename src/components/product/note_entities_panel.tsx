import Link from "next/link";
import { Network } from "lucide-react";
import { EntityChip, type EntityChipType } from "@/components/product/entity_chip";

type EntityWithMention = {
  id: string;
  name: string;
  entity_type: EntityChipType;
  mention_count: number;
  surface_form: string;
  context: string | null;
};

interface NoteEntitiesPanelProps {
  entities: EntityWithMention[];
}

export function NoteEntitiesPanel({ entities }: NoteEntitiesPanelProps) {
  if (entities.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-5 text-center">
        <Network className="mx-auto h-5 w-5 text-muted-foreground/40 mb-1.5" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">
          No entities extracted yet. Save the note and entities will appear here within a few seconds.
        </p>
      </div>
    );
  }

  // Group by entity type for cleaner presentation
  const groups = new Map<EntityChipType, EntityWithMention[]>();
  for (const e of entities) {
    const bucket = groups.get(e.entity_type) ?? [];
    bucket.push(e);
    groups.set(e.entity_type, bucket);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Network className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          Entities in this note ({entities.length})
        </p>
        <Link
          href="/app/graph"
          className="ml-auto text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          View all →
        </Link>
      </div>

      <div className="space-y-3">
        {[...groups.entries()].map(([type, items]) => (
          <div key={type}>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 capitalize">
              {type}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {items.map((e) => (
                <EntityChip
                  key={e.id}
                  id={e.id}
                  name={e.name}
                  type={e.entity_type}
                  mentionCount={e.mention_count}
                  interactive
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
