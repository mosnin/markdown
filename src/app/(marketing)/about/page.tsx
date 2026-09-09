import type { Metadata } from "next";
import { AboutPage } from "@/components/marketing/pages/about";

export const metadata: Metadata = {
  title: "About",
  description: "Why Poggle exists.",
};

export default function Page() {
  return <AboutPage />;
}
