import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Blog — Poggle",
  description: "Articles, guides, and updates from the Poggle team.",
};

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Blog"
        title="Articles, guides, and updates."
        description="Notes from the team behind Poggle."
      />

      <section className="mx-auto w-full max-w-2xl px-6 py-20">
        <Card>
          <CardHeader>
            <CardTitle>Coming soon</CardTitle>
            <CardDescription>
              We&apos;re working on our first posts. In the meantime, check the
              changelog for the latest updates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/changelog" />}>
              View changelog
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
