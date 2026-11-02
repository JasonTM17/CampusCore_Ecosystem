import Link from 'next/link';
import { getMessages } from '@/i18n/messages';
import { getRequestLocale, isPrefixedRequest } from '@/i18n/server';
import { localizePathname } from '@/i18n/paths';

/**
 * Post-logout landing owned by Next (docs/ecosystem/host-policy.md §3 —
 * the Java BFF only returns a probe; this static page is the real
 * destination the `id` host's /connect/logout redirects back to).
 */
export default async function LoggedOutPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const copy = messages.session.loggedOut;
  // Same rule the LocalizedLink component applies: a prefixed visit keeps its
  // prefix, an unprefixed default-locale visit stays unprefixed, and a
  // non-default locale reached through the cookie keeps its /en (or /vi)
  // address. Landing on a bare '/' would reset an English visitor to Vietnamese.
  const homeHref = localizePathname('/', locale, await isPrefixedRequest());

  return (
    <main
      style={{
        display: 'flex',
        minHeight: '60vh',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>
          {copy.title}
        </h1>
        <p style={{ color: '#555', marginBottom: '1.5rem' }}>
          {copy.body}
        </p>
        <Link
          href={homeHref}
          style={{
            color: '#1d4ed8',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {copy.returnHome}
        </Link>
      </div>
    </main>
  );
}
