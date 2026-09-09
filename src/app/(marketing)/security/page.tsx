import type { Metadata } from "next";
import { SecurityPage } from "@/components/marketing/pages/security";

export const metadata: Metadata = {
  title: "Security",
  description: "How Poggle handles the most secret-dense data a developer tool can hold.",
};

export default function Page() {
  return <SecurityPage />;
}
