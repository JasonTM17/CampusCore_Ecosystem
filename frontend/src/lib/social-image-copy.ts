import { defaultLocale, isLocale, type Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';

/**
 * The single size contract for every social card. `ImageResponse` renders at
 * 1200x630 so Open Graph, Twitter and the localized route cannot disagree.
 */
export const SOCIAL_IMAGE_SIZE = { width: 1200, height: 630 } as const;

export interface SocialImageCopy {
  locale: Locale;
  alt: string;
  eyebrow: string;
  title: string;
  description: string;
  badges: readonly string[];
}

/**
 * Resolves the locale a social card renders in.
 *
 * The file-convention routes (`app/opengraph-image.tsx`, re-exported by
 * `app/twitter-image.tsx`) have no locale segment: Next serves them from a
 * single URL and crawlers fetch them without the page's locale, so they always
 * render `defaultLocale` (vi). The localized `/social-image/[locale]` route
 * passes its own segment through here, and both read the same
 * `messages.meta.socialImage` catalogue copy.
 */
export function resolveSocialImageLocale(locale?: string | null): Locale {
  return isLocale(locale) ? locale : defaultLocale;
}

export function getSocialImageCopy(locale?: string | null): SocialImageCopy {
  const resolved = resolveSocialImageLocale(locale);
  const social = getMessages(resolved).meta.socialImage;

  return {
    locale: resolved,
    alt: `${social.eyebrow} — ${social.title}`,
    eyebrow: social.eyebrow,
    title: social.title,
    description: social.description,
    badges: social.badges,
  };
}
