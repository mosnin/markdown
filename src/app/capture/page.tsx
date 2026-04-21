import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { CaptureView } from "@/components/product/capture_view";

interface PageProps {
  searchParams: Promise<{
    title?: string | string[];
    text?: string | string[];
    url?: string | string[];
  }>;
}

function pickString(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export default async function CapturePage({ searchParams }: PageProps) {
  let ctx;
  try {
    ctx = await requireAuthenticatedUser();
  } catch {
    redirect("/sign_in?next=/capture");
  }

  const sp = await searchParams;
  const sharedTitle = pickString(sp.title).trim();
  const sharedText = pickString(sp.text).trim();
  const sharedUrl = pickString(sp.url).trim();

  // Build initial body: text first, then url on its own line if present.
  // If there's no text but there is a url, body is just the url.
  const initialBody = [sharedText, sharedUrl].filter(Boolean).join("\n\n");
  // Title: shared title, or first 80 chars of body, or empty
  const initialTitle =
    sharedTitle ||
    (initialBody ? initialBody.split("\n")[0].slice(0, 80) : "");

  const supabase = await createClient();
  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  return (
    <CaptureView
      workspaceId={ctx.workspace.id}
      workspaceName={ctx.workspace.name}
      boxes={boxes.map((b) => ({ id: b.id, name: b.name, slug: b.slug }))}
      initialTitle={initialTitle}
      initialBody={initialBody}
      hasShareData={Boolean(sharedTitle || sharedText || sharedUrl)}
    />
  );
}
