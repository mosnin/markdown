import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getWorkflowById } from "@/server/repositories/workflow_repository";
import { WorkflowCanvas } from "@/components/product/workflows/workflow_canvas";

interface EditPageProps {
  params: Promise<{ workflow_id: string }>;
}

export default async function WorkflowEditPage({ params }: EditPageProps) {
  const { workflow_id } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const workflow = await getWorkflowById(supabase, workflow_id);
  if (!workflow || workflow.workspace_id !== ctx.workspace.id) notFound();

  return <WorkflowCanvas workflow={workflow} />;
}
