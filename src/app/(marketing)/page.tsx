import type { Metadata } from "next";
import { HomePage } from "@/components/marketing/pages/home";

const description =
  "Poggle is shared memory for coding agents. Agents log what they do as they do it, so the next one — different tool, different account, different machine — picks up where the last one stopped.";

export const metadata: Metadata = {
  title: { absolute: "Poggle | Shared memory for coding agents" },
  description,
  alternates: { canonical: "https://poggle.xyz" },
  openGraph: {
    type: "website",
    url: "https://poggle.xyz",
    siteName: "Poggle",
    title: "Poggle | Shared memory for coding agents",
    description,
  },
};

export default function Page() {
  return <HomePage />;
}
