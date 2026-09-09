import type { Metadata } from "next";
import { DocsPage } from "@/components/marketing/pages/docs";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Hooks, MCP tools and the HTTP API.",
};

export default function Page() {
  return <DocsPage />;
}
