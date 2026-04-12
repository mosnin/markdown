/**
 * OOB fallback: when a connector uses `urn:ietf:wg:oauth:2.0:oob` as
 * its redirect_uri (typically CLI-style clients), we show the code
 * here for the user to copy into the connector UI. The connector then
 * exchanges it for tokens at /api/oauth/token just like any other
 * redirect_uri flow.
 */
export default async function AuthorizationCodePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; state?: string }>;
}) {
  const params = await searchParams;
  const code = params.code ?? "";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-sm p-6">
        <h1 className="text-lg font-semibold">Authorization code</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Copy this code and paste it into your connector. It expires in 10
          minutes and can only be used once.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 text-xs font-mono">
          {code}
        </pre>
        <p className="mt-4 text-xs text-muted-foreground">
          If you did not initiate this flow, close this page — no tokens will
          be issued until the code is exchanged.
        </p>
      </div>
    </div>
  );
}
