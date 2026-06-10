-- Link OAuth clients to a real `connections` row.
--
-- OAuth-connected agents are not provisioned through the token-based connect
-- flow, but the writes they make stamp a connection: write_proposals.connection_id
-- and notes.generated_by_connection_id are uuid FKs to public.connections. The
-- MCP route previously synthesized a fake `oauth:<clientId>` string for these,
-- which is not a uuid and crashed every OAuth-agent write (create_write_proposal
-- and create_generated_note). Give each (workspace, OAuth client) a real
-- connections row instead — which also makes OAuth agents count toward the
-- connected-agent cap, since that cap is a live count of `connections`.

ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS oauth_client_id text
    REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE;

-- At most one connection per (workspace, OAuth client).
CREATE UNIQUE INDEX IF NOT EXISTS connections_workspace_oauth_client_idx
  ON public.connections (workspace_id, oauth_client_id)
  WHERE oauth_client_id IS NOT NULL;
