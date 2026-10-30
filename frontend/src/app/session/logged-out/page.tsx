import Link from 'next/link';
import { getMessages } from '@/i18n/messages';
import { getRequestLocale } from '@/i18n/server';

/**
 * Post-logout landing owned by Next (docs/ecosystem/host-policy.md §3 —
 * the Java BFF only returns a probe; this static page is the real
 * destination the `id` host's /connect/logout redirects back to).
 */
export default async function LoggedOutPage() {
  const messages = getMessages(await getRequestLocale());
  const copy = messages.session.loggedOut;

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
          href="/"
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
