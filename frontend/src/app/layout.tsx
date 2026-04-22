import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "sonner";
import { I18nProvider } from "@/i18n";
import {
  getHtmlLang,
  getLocalizedMetadata,
  getRequestLocale,
  isPrefixedRequest,
} from "@/i18n/server";

export const dynamic = 'force-dynamic';

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-sans",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export async function generateMetadata() {
  return getLocalizedMetadata();
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [locale, htmlLang, prefixed] = await Promise.all([
    getRequestLocale(),
    getHtmlLang(),
    isPrefixedRequest(),
  ]);

  return (
    <html lang={htmlLang} suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen">
        <ThemeProvider>
          <I18nProvider locale={locale} isPrefixed={prefixed}>
            <AuthProvider>
              {children}
              <Toaster position="top-right" richColors />
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
