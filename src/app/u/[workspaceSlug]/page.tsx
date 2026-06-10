import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceBySlug, listPublicBoxesByWorkspace } from "@/server/repositories/box_repository";
import { Box } from "lucide-react";
import Link from "next/link";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { workspaceSlug } = await params;
  const supabase = createAdminClient();
  const workspace = await getWorkspaceBySlug(supabase, workspaceSlug);

  if (!workspace) {
    return { title: "Not found" };
  }

  // A workspace only has a public profile once it shares ≥1 public box —
  // otherwise don't disclose its name/existence (no public-profile opt-in flag).
  const publicBoxes = await listPublicBoxesByWorkspace(supabase, workspace.id);
  if (publicBoxes.length === 0) {
    return { title: "Not found" };
  }

  return {
    title: `${workspace.name} — Public Boxes`,
    description: `Browse public knowledge boxes shared by ${workspace.name}.`,
    openGraph: {
      title: `${workspace.name} — Public Boxes`,
      description: `Browse public knowledge boxes shared by ${workspace.name}.`,
      type: "profile",
    },
    twitter: {
      card: "summary",
      title: `${workspace.name} on Poggle`,
    },
  };
}

export default async function UserProfilePage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const supabase = createAdminClient();

  const workspace = await getWorkspaceBySlug(supabase, workspaceSlug);
  if (!workspace) notFound();

  const publicBoxes = await listPublicBoxesByWorkspace(supabase, workspace.id);
  // Only expose the profile (incl. the workspace name) when something is
  // actually shared publicly — no public boxes means no public profile.
  if (publicBoxes.length === 0) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted text-lg font-semibold text-foreground">
          {workspace.name[0]?.toUpperCase() ?? "?"}
        </div>
        <h1 className="mt-3 text-xl font-semibold text-foreground">{workspace.name}</h1>
        <p className="text-sm text-muted-foreground">@{workspace.slug}</p>
      </div>

      {publicBoxes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No public boxes yet.</p>
      ) : (
        <div className="space-y-2">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
            Public boxes
          </p>
          {publicBoxes.map((box) => (
            <div key={box.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <Box className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{box.name}</p>
                {box.description && (
                  <p className="truncate text-xs text-muted-foreground">{box.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-12 border-t border-border pt-4 text-xs text-muted-foreground">
        Powered by <Link href="/" className="underline hover:text-foreground">Poggle</Link>
      </div>
    </div>
  );
}
