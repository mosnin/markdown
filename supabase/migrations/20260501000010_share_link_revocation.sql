-- Share link revocation.
--
-- Share tokens previously were a pure HMAC of the resource id, so a link
-- could never be invalidated. We mix a per-row `share_version` integer into
-- the signed payload (`id:version`). Bumping the version changes the HMAC,
-- so every previously issued link 404s. The box privacy toggle (is_public ->
-- false) bumps the box version, and an explicit revoke action bumps either.
--
-- Starts at 1; the token encodes whichever value was current when the link
-- was generated. Share pages require row.share_version === token.version.
ALTER TABLE public.boxes ADD COLUMN IF NOT EXISTS share_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS share_version integer NOT NULL DEFAULT 1;
