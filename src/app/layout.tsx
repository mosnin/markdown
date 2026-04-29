import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/product/theme_provider";
import { ServiceWorkerRegister } from "@/components/product/sw_register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Poggle",
  description:
    "A structured, markdown-native context operating system for humans and AI.",
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
  themeColor: "#7c3aed",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // allow user zoom; do NOT lock viewport
  userScalable: true,
  viewportFit: "cover", // edge-to-edge on notched devices
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
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
