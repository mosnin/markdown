/**
 * How to reach the people who run this deployment. Public, so it is a
 * `NEXT_PUBLIC_` variable set on the Next host, and optional: a deployment
 * that has not named an address shows the GitHub route only, rather than a
 * placeholder nobody reads.
 */
export const CONTACT_EMAIL: string | null =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;

export const ISSUES_URL = "https://github.com/mosnin/poggle/issues";
