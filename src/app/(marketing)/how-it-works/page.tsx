import type { Metadata } from "next";
import { HowItWorksPage } from "@/components/marketing/pages/how-it-works";

export const metadata: Metadata = {
  title: "How it works",
  description: "Install the hooks, run your agents, and the context carries itself.",
};

export default function Page() {
  return <HowItWorksPage />;
}
