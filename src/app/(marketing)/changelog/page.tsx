import type { Metadata } from "next";
import { ChangelogPage } from "@/components/marketing/pages/changelog";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What changed in Poggle.",
};

export default function Page() {
  return <ChangelogPage />;
}
