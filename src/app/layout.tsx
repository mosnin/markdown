import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/product/theme_provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Poggle",
  description:
    "A structured, markdown-native context operating system for humans and AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="h-full bg-background text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Base UI TooltipProvider uses `delay` not `delayDuration` */}
          <TooltipProvider delay={400}>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
