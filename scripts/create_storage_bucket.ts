/**
 * Idempotent one-shot: create the "note-images" Supabase Storage bucket.
 *
 * Run: pnpm tsx scripts/create_storage_bucket.ts
 *
 * Does NOT configure RLS policies — those live in supabase/migrations/*.sql.
 * If the bucket already exists, prints "bucket exists" and exits 0.
 */

const BUCKET_NAME = "note-images";

async function main(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error("NEXT_PUBLIC_SUPABASE_URL is not set");
    process.exit(1);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not set");
    process.exit(1);
  }

  // Lazy import after env is validated.
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const admin = createAdminClient();

  // List first so we stay idempotent.
  const list = await admin.storage.listBuckets();
  if (list.error) {
    console.error(`listBuckets failed: ${list.error.message}`);
    process.exit(1);
  }
  const existing = (list.data ?? []).find((b) => b.name === BUCKET_NAME);
  if (existing) {
    console.log(`bucket exists: ${BUCKET_NAME}`);
    process.exit(0);
  }

  const { data, error } = await admin.storage.createBucket(BUCKET_NAME, {
    public: true,
  });
  if (error) {
    // If another concurrent creator won, treat "already exists" as success.
    if (error.message.toLowerCase().includes("already exists")) {
      console.log(`bucket exists: ${BUCKET_NAME}`);
      process.exit(0);
    }
    console.error(`createBucket failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`created bucket: ${data?.name ?? BUCKET_NAME}`);
  console.log(
    "Note: RLS policies are NOT configured by this script. Apply them via SQL migrations.",
  );
}

main().catch((err) => {
  console.error("create_storage_bucket: unexpected error:", err);
  process.exit(1);
});
