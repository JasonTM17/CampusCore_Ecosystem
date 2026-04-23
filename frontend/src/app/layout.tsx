import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "sonner";
import { I18nProvider } from "@/i18n";
import { isLocale } from "@/i18n/config";
import {
  getHtmlLang,
  getLocalizedMetadata,
  getRequestLocale,
  isPrefixedRequest,
} from "@/i18n/server";

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return getLocalizedMetadata();
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params?: Promise<{ locale?: string }>;
}) {
  const resolvedParams = params ? await params : {};
  const routeLocale = isLocale(resolvedParams.locale)
    ? resolvedParams.locale
    : null;
  const [requestLocale, requestHtmlLang, requestPrefixed] = await Promise.all([
    getRequestLocale(),
    getHtmlLang(),
    isPrefixedRequest(),
  ]);
  const locale = routeLocale ?? requestLocale;
  const htmlLang = routeLocale ?? requestHtmlLang;
  const prefixed = routeLocale ? true : requestPrefixed;

  return (
    <html lang={htmlLang} suppressHydrationWarning>
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
