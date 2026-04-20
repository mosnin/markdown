import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getNoteById } from "@/server/repositories/note_repository";
import type { RunArtifact } from "@/server/services/operator_artifacts_service";

/**
 * "Summary of what changed" panel for an Operator run.
 *
 * Not a unified diff — for v1 we render a list of cards, one per note
 * the run produced. Each card shows the note's current title and a
 * 200-char preview pulled from the live row. Rolled-back / trashed
 * notes are greyed out and labelled.
 */

export interface OperatorRunDiffProps {
  artifacts: RunArtifact[];
}

interface ResolvedArtifact extends RunArtifact {
  preview: string;
}

const PREVIEW_CHARS = 200;

export async function OperatorRunDiff({ artifacts }: OperatorRunDiffProps) {
  const resolved = await resolveArtifacts(artifacts);
  return <OperatorRunDiffView resolved={resolved} />;
}

/**
 * Pure view — exported so unit tests (no DOM) can render it with a
 * pre-resolved artifact list and assert the rolled-back affordance
 * without spinning up Supabase mocks.
 */
export function OperatorRunDiffView({
  resolved,
}: {
  resolved: ResolvedArtifact[];
}) {
  if (resolved.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Summary of what changed</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            This run did not produce any artifacts.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary of what changed</CardTitle>
        <p className="text-xs text-muted-foreground">
          {resolved.length} note{resolved.length === 1 ? "" : "s"} created by
          this run. Greyed-out entries have been rolled back.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {resolved.map((a) => (
          <ArtifactRow key={a.noteId} artifact={a} />
        ))}
      </CardContent>
    </Card>
  );
}

function ArtifactRow({ artifact }: { artifact: ResolvedArtifact }) {
  const isDeleted = artifact.deleted;
  return (
    <div
      data-rolled-back={isDeleted ? "true" : "false"}
      className={
        "rounded-lg border border-border p-3 " +
        (isDeleted ? "opacity-60" : "")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/app/notes/${artifact.noteId}`}
            className={
              "block truncate text-sm font-medium " +
              (isDeleted
                ? "line-through text-muted-foreground"
                : "text-foreground hover:underline")
            }
          >
            {artifact.title ?? "(untitled note)"}
          </Link>
          {artifact.preview && (
            <p
              className={
                "mt-1 text-xs " +
                (isDeleted ? "text-muted-foreground" : "text-muted-foreground")
              }
            >
              {artifact.preview}
            </p>
          )}
        </div>
        {isDeleted && <Badge variant="warning">deleted</Badge>}
      </div>
    </div>
  );
}

// ─── Loaders ───────────────────────────────────────────────────────────────

async function resolveArtifacts(
  artifacts: RunArtifact[]
): Promise<ResolvedArtifact[]> {
  if (artifacts.length === 0) return [];
  const supabase = await createClient();
  const out: ResolvedArtifact[] = [];
  for (const a of artifacts) {
    let preview = "";
    if (!a.deleted) {
      try {
        const note = await getNoteById(supabase, a.noteId);
        const body =
          (note as unknown as { markdown_content?: string } | null)
            ?.markdown_content ?? "";
        preview = body.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS);
      } catch {
        preview = "";
      }
    }
    out.push({ ...a, preview });
  }
  return out;
}
