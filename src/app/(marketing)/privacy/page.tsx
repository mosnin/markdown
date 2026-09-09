import type { Metadata } from "next";
import { ContentPage } from "@/components/marketing/content-page";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Poggle stores, why, and what it deliberately does not.",
};

export default function Page() {
  return (
    <ContentPage
      title="Privacy"
      updated="September 2026"
      intro="Poggle stores what your coding agents do. That is unusually sensitive data, so this page is specific about what is kept, what is stripped, and what never arrives at all."
      sections={[
        {
          title: "What we store",
          content: (
            <>
              <p>
                Session metadata (which agent, which plan label, which branch,
                when it started and how it ended), an append-only log of events
                with short summaries and structured detail, and — when you
                enable it — segmented transcripts of the agent conversation.
              </p>
              <p>
                Account data is limited to what is needed to sign you in and
                bill you: an email address, workspace membership, and
                subscription state.
              </p>
            </>
          ),
        },
        {
          title: "What is stripped before storage",
          content: (
            <>
              <p>
                Credentials are scrubbed on your machine before anything is
                sent, and scrubbed again on arrival. Bearer tokens, provider API
                keys, JWTs, connection-string passwords, private key blocks and
                sensitive environment assignments are replaced with markers.
              </p>
              <p>
                Home directories are removed from file paths, because an
                absolute path identifies a person and a machine while a relative
                one does not.
              </p>
              <p>
                Bulk tool output is truncated at capture. We keep the head and
                the tail; the middle is dropped and not recoverable.
              </p>
            </>
          ),
        },
        {
          title: "What we do not do",
          content: (
            <>
              <p>
                Your session data is not used to train models. It is not sold,
                and it is not shared with third parties beyond the
                infrastructure providers needed to run the service.
              </p>
              <p>
                We do not read your logs except when you ask us to help with a
                specific problem, and we would rather you redact and paste than
                grant us access.
              </p>
            </>
          ),
        },
        {
          title: "Retention and deletion",
          content: (
            <>
              <p>
                History retention follows your plan. Deleting a project removes
                its sessions, events, transcripts and briefs. Deleting a
                workspace removes everything belonging to it.
              </p>
              <p>
                Revoking a relay key stops new data arriving from that machine
                immediately; it does not remove what was already logged, because
                the log is append-only by design.
              </p>
            </>
          ),
        },
        {
          title: "Self-hosting",
          content: (
            <p>
              Poggle is a Next.js application over a Postgres database. If none
              of the above is acceptable for your code, run it yourself and this
              page stops being about us.
            </p>
          ),
        },
      ]}
    />
  );
}
