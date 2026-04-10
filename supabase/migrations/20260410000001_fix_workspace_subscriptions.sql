-- Add manually_overridden column if it doesn't exist
ALTER TABLE public.workspace_subscriptions
  ADD COLUMN IF NOT EXISTS manually_overridden boolean NOT NULL DEFAULT false;

-- Fix the FK to cascade on workspace deletion
-- First drop the existing FK, then re-add with CASCADE
ALTER TABLE public.workspace_subscriptions
  DROP CONSTRAINT IF EXISTS workspace_subscriptions_workspace_id_fkey;

ALTER TABLE public.workspace_subscriptions
  ADD CONSTRAINT workspace_subscriptions_workspace_id_fkey
  FOREIGN KEY (workspace_id)
  REFERENCES public.workspaces(id)
  ON DELETE CASCADE;

-- Add explicit deny policies for INSERT/UPDATE/DELETE to prevent
-- accidental writes via the user-scoped client (all writes should
-- go through the service-role client only)
DROP POLICY IF EXISTS "workspace_subscriptions_no_direct_insert" ON public.workspace_subscriptions;
CREATE POLICY "workspace_subscriptions_no_direct_insert"
  ON public.workspace_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "workspace_subscriptions_no_direct_update" ON public.workspace_subscriptions;
CREATE POLICY "workspace_subscriptions_no_direct_update"
  ON public.workspace_subscriptions FOR UPDATE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "workspace_subscriptions_no_direct_delete" ON public.workspace_subscriptions;
CREATE POLICY "workspace_subscriptions_no_direct_delete"
  ON public.workspace_subscriptions FOR DELETE
  TO authenticated
  USING (false);

-- Add index on creem_subscription_id for webhook lookups
CREATE INDEX IF NOT EXISTS workspace_subscriptions_creem_subscription_id_idx
  ON public.workspace_subscriptions(creem_subscription_id);
