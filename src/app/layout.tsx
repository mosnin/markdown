import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/product/theme_provider";
import { MotionProvider } from "@/components/product/motion_provider";
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
