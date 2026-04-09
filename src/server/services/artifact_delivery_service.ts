import { type SupabaseClient } from "@supabase/supabase-js";
import { type ExportPackage } from "@/server/domain/types/import_export";
import { packageToZip } from "@/server/services/export_service";

/**
 * Export artifact delivery service.
 *
 * Packages an ExportPackage into a zip, uploads it to the private Supabase
 * Storage 'exports' bucket, and returns a short-lived signed download URL.
 *
 * Security model:
 *   - The 'exports' bucket is private — no public URLs are ever issued.
 *   - All uploads and signed URL generation use the admin (service-role) client
 *     because the authenticated user client has no write access to Storage.
 *   - Ownership verification must happen before calling this service — it is
 *     not re-checked here.
 *   - Signed URLs are never logged or included in audit events.
 *
 * Storage path convention:
 *   {workspaceId}/{unix-ms}-{filename}
 *
 * V1 cleanup:
 *   Artifacts accumulate. Signed URLs expire (1 hour) so artifacts become
 *   inaccessible without a new URL, but the files remain in storage.
 *   A future retention job can purge paths older than a threshold (e.g. 7 days).
 */

const EXPORT_BUCKET = "exports";
const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

export interface ArtifactDeliveryResult {
  signed_url: string;
  expires_at: string;
  filename: string;
  size_bytes: number;
}

/**
 * Package an ExportPackage into a zip and upload it to Storage.
 * Returns a signed URL valid for 1 hour.
 *
 * @param adminClient  Service-role Supabase client (bypasses RLS).
 * @param workspaceId  Used as the storage path prefix.
 * @param pkg          The assembled ExportPackage from the export service.
 */
export async function deliverExportPackage(
  adminClient: SupabaseClient,
  workspaceId: string,
  pkg: ExportPackage
): Promise<ArtifactDeliveryResult> {
  const zip = packageToZip(pkg);
  const storagePath = `${workspaceId}/${Date.now()}-${pkg.filename}`;

  const { error: uploadError } = await adminClient.storage
    .from(EXPORT_BUCKET)
    .upload(storagePath, zip, {
      contentType: "application/zip",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Export artifact upload failed: ${uploadError.message}`);
  }

  const { data: signedData, error: signError } = await adminClient.storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, {
      download: pkg.filename,
    });

  if (signError || !signedData?.signedUrl) {
    throw new Error(
      `Failed to create signed export URL: ${signError?.message ?? "unknown error"}`
    );
  }

  const expiresAt = new Date(
    Date.now() + SIGNED_URL_TTL_SECONDS * 1000
  ).toISOString();

  return {
    signed_url: signedData.signedUrl,
    expires_at: expiresAt,
    filename: pkg.filename,
    size_bytes: zip.length,
  };
}
