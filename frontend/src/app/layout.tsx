import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "sonner";
import { getSiteUrl } from "@/lib/site";

export const dynamic = 'force-dynamic';

const siteUrl = getSiteUrl();

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-sans",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "CampusCore",
    template: "%s | CampusCore",
  },
  description:
    "CampusCore is a campus operations workspace for identity, academics, finance, engagement, people data, and analytics.",
  applicationName: "CampusCore",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "CampusCore",
    description:
      "A campus operations workspace with stable browser auth, clear service ownership, and verified runtime delivery.",
    url: "/",
    siteName: "CampusCore",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "CampusCore workspace overview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CampusCore",
    description:
      "A campus operations workspace for academics, finance, engagement, analytics, and secure browser sessions.",
    images: ["/twitter-image"],
  },
  robots: {
    index: true,
    follow: true,
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen">
        <ThemeProvider>
          <AuthProvider>
            {children}
            <Toaster position="top-right" richColors />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
