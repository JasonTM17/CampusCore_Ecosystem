import { ImageResponse } from 'next/og';
import { defaultLocale, isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';

export const runtime = 'edge';

const size = {
  width: 1200,
  height: 630,
};

function buildImage(locale: string) {
  const resolvedLocale = isLocale(locale) ? locale : defaultLocale;
  const messages = getMessages(resolvedLocale);
  const social = messages.meta.socialImage;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          background: '#0f1724',
          color: '#f8fafc',
          padding: '56px',
          fontFamily: 'Inter, system-ui, sans-serif',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at top left, rgba(56, 189, 248, 0.16), transparent 34%), radial-gradient(circle at bottom right, rgba(249, 115, 22, 0.16), transparent 30%)',
          }}
        />
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            borderRadius: 28,
            border: '1px solid rgba(148, 163, 184, 0.18)',
            background: 'rgba(15, 23, 36, 0.82)',
            padding: '40px 44px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                color: '#cbd5e1',
                fontSize: 24,
                textTransform: 'uppercase',
                letterSpacing: '0.22em',
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: '#f97316',
                }}
              />
              {social.eyebrow}
            </div>
            <div
              style={{
                fontSize: 64,
                lineHeight: 1.04,
                fontWeight: 700,
                maxWidth: 820,
              }}
            >
              {social.title}
            </div>
            <div
              style={{
                fontSize: 28,
                lineHeight: 1.42,
                color: '#cbd5e1',
                maxWidth: 860,
              }}
            >
              {social.description}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
            }}
          >
            {social.badges.map((item) => (
              <div
                key={item}
                style={{
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: 18,
                  padding: '14px 18px',
                  fontSize: 24,
                  color: '#e2e8f0',
                  background: 'rgba(30, 41, 59, 0.6)',
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ locale: string }> },
) {
  const { locale } = await context.params;
  return buildImage(locale);
}
