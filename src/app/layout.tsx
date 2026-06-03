import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Share_Tech_Mono, Space_Grotesk } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/product/theme_provider";
import { MotionProvider } from "@/components/product/motion_provider";
import { ServiceWorkerRegister } from "@/components/product/sw_register";
import { getCanonicalBaseUrl } from "@/lib/canonical_url";
import "./globals.css";

// Brand display fonts, self-hosted via next/font (CSP-safe — a Google Fonts
// @import would be blocked by the strict font-src/style-src CSP). Share Tech Mono
// drives the logo wordmark + all title/heading text; Space Grotesk drives the
// hero. To flip the mapping, swap the two --font-* values in globals.css.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const shareTechMono = Share_Tech_Mono({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-share-tech-mono",
  display: "swap",
});

const SITE_DESCRIPTION =
  "Agents connect over MCP, read your workspace context, and propose changes you approve. Poggle is the trust gate between your AI agents and your source of truth.";

export const metadata: Metadata = {
  metadataBase: new URL(getCanonicalBaseUrl()),
  title: "Poggle",
  description:
    "A structured, markdown-native context operating system for humans and AI.",
  openGraph: {
    type: "website",
    siteName: "Poggle",
    title: "Poggle — The governed context layer for AI agents",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Poggle — The governed context layer for AI agents",
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: "/logo-symbol-light.png",
    shortcut: "/logo-symbol-light.png",
    apple: "/logo-symbol-light.png",
  },
  manifest: "/manifest.webmanifest",
  applicationName: "Poggle",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Poggle",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${spaceGrotesk.variable} ${shareTechMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="h-full bg-background text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <MotionProvider>
            {/* Base UI TooltipProvider uses `delay` not `delayDuration` */}
            <TooltipProvider delay={400}>{children}</TooltipProvider>
          </MotionProvider>
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
