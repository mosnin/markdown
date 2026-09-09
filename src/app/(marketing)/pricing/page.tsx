import type { Metadata } from "next";
import { PricingPage } from "@/components/marketing/pages/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free while you try it. Priced per developer when your team relies on it.",
};

export default function Page() {
  return <PricingPage />;
}
