import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Network } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getEntityById } from "@/server/repositories/entity_repository";
import { listMentionsByEntity } from "@/server/repositories/entity_mention_repository";
import { listEdgesForEntity } from "@/server/repositories/entity_edge_repository";
import { getNoteById } from "@/server/repositories/note_repository";
import { EntityChip } from "@/components/product/entity_chip";
import type { EntityChipType } from "@/components/product/entity_chip";
import { EntityMergeDialog } from "@/components/product/entity_merge_dialog";

export default async function EntityPage({ params }: { params: Promise<{ entity_id: string }> }) {
  const { entity_id } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const entity = await getEntityById(supabase, entity_id);
  if (!entity || entity.workspace_id !== ctx.workspace.id) notFound();

  const [mentions, edges] = await Promise.all([
    listMentionsByEntity(supabase, entity.id, { limit: 100 }),
    listEdgesForEntity(supabase, entity.id),
  ]);

  // Load notes for mentions
  const uniqueNoteIds = [...new Set(mentions.map((m) => m.note_id))];
  const notes = await Promise.all(uniqueNoteIds.map((id) => getNoteById(supabase, id)));
  const noteMap = new Map(notes.filter((n) => n).map((n) => [n!.id, n!]));

  // Load connected entity names
  const connectedEntityIds = [...new Set(edges.flatMap((e) => [e.source_entity_id, e.target_entity_id]))].filter((id) => id !== entity.id);
  const connectedEntities = await Promise.all(connectedEntityIds.map((id) => getEntityById(supabase, id)));
  const entityMap = new Map(connectedEntities.filter((e) => e).map((e) => [e!.id, e!]));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <Link href="/app/graph" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2">
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          All entities
        </Link>
        <div className="flex items-center gap-3">
          <EntityChip id={entity.id} name={entity.name} type={entity.entity_type as EntityChipType} interactive={false} size="md" mentionCount={entity.mention_count} />
          <div className="ml-auto">
            <EntityMergeDialog sourceEntity={{ id: entity.id, name: entity.name, entity_type: entity.entity_type as EntityChipType }} />
          </div>
        </div>
        {entity.description && (
          <p className="mt-2 text-sm text-muted-foreground max-w-3xl">{entity.description}</p>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Connections */}
          {edges.length > 0 && (
            <section>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground mb-3">
                <Network className="h-3.5 w-3.5" aria-hidden="true" />
                Connections ({edges.length})
              </h2>
              <div className="flex flex-wrap gap-2">
                {edges.map((edge) => {
                  const otherId = edge.source_entity_id === entity.id ? edge.target_entity_id : edge.source_entity_id;
                  const other = entityMap.get(otherId);
                  if (!other) return null;
                  return (
                    <div key={edge.id} className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                      <span className="text-muted-foreground/70">{edge.source_entity_id === entity.id ? "→" : "←"} {edge.edge_type.replace(/_/g, " ")}</span>
                      <EntityChip id={other.id} name={other.name} type={other.entity_type as EntityChipType} interactive />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Mentions */}
          <section>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground mb-3">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Appears in {uniqueNoteIds.length} note{uniqueNoteIds.length === 1 ? "" : "s"}
            </h2>
            <div className="space-y-2">
              {uniqueNoteIds.map((nid) => {
                const note = noteMap.get(nid);
                const mention = mentions.find((m) => m.note_id === nid);
                if (!note) return null;
                return (
                  <Link
                    key={nid}
                    href={`/app/notes/${nid}`}
                    className="block rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/40"
                  >
                    <p className="text-sm font-medium text-foreground truncate">{note.title}</p>
                    {mention?.context && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        &ldquo;{mention.context}&rdquo;
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
