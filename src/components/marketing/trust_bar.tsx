/**
 * Quiet "Trusted by" row.
 *
 * Six monochrome wordmark placeholders rendered in `text-foreground/40`,
 * lifting to `/60` on hover. No icons, no animation. The list is data-driven
 * so a real customer logo set can swap in without restructuring.
 */
const COMPANIES = [
  "Acme",
  "Northwind",
  "Helix",
  "Vector",
  "Atlas",
  "Quanta",
] as const;

export function TrustBar() {
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-overline text-muted-foreground/60">
        Trusted by teams at
      </p>
      <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:gap-x-8">
        {COMPANIES.map((name) => (
          <li
            key={name}
            className="text-sm font-semibold tracking-tight text-foreground/40 transition-colors hover:text-foreground/60"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}
