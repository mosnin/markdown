import type { Metadata } from "next";
import { ProductPage } from "@/components/marketing/pages/product";

export const metadata: Metadata = {
  title: "Product",
  description: "The session log, handoff briefs, live coordination, and the hooks that feed them.",
};

export default function Page() {
  return <ProductPage />;
}
