import type { Locale } from '@/i18n/config';

type NewsCopy = {
  title: string;
  subtitle: string;
  notFoundTitle: string;
  notFoundBody: string;
};

type PublicNewsItem = {
  id?: string;
  slug?: string | null;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  status?: string | null;
  archivedAt?: string | null;
  expiresAt?: string | null;
  publishAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  coverImageUrl?: string | null;
};

type PublicDocumentItem = {
  slug?: string | null;
  publishedAt?: string | null;
};

function normalizedSiteUrl(siteUrl: string) {
  return siteUrl.replace(/\/$/, '');
}

function canonicalPath(pathname: string, locale: Locale) {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`;
}

function absoluteUrl(siteUrl: string, pathname: string) {
  return new URL(pathname, `${normalizedSiteUrl(siteUrl)}/`).toString();
}

function languageAlternates(siteUrl: string, pathname: string) {
  return {
    'en-US': absoluteUrl(siteUrl, canonicalPath(pathname, 'en')),
    'vi-VN': absoluteUrl(siteUrl, canonicalPath(pathname, 'vi')),
    'x-default': absoluteUrl(siteUrl, canonicalPath(pathname, 'vi')),
  };
}

function cleanDescription(value: unknown, maxLength = 180) {
  if (typeof value !== 'string') return '';
  const clean = value
    .replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*`_~|>-]/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength).trim()}…`;
}

function safeCoverUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (/^\/(?!\/)/.test(url) && !/[\u0000-\u0020]/.test(url)) {
    return url;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function localizedSocialImage(locale: Locale) {
  return `/social-image/${locale}`;
}

function isNotPublished(status: unknown) {
  return typeof status === 'string' && status.trim().length > 0 && status.toUpperCase() !== 'PUBLISHED';
}

export function buildNewsListMetadata(
  locale: Locale,
  siteUrl: string,
  copy: NewsCopy,
) {
  const pathname = '/news';
  const canonical = absoluteUrl(siteUrl, canonicalPath(pathname, locale));
  const description = cleanDescription(copy.subtitle, 200);
  const title = cleanDescription(copy.title, 100);
  const image = absoluteUrl(siteUrl, localizedSocialImage(locale));

  return {
    metadataBase: new URL(normalizedSiteUrl(siteUrl)),
    title,
    description,
    alternates: {
      canonical,
      languages: languageAlternates(siteUrl, pathname),
    },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'website' as const,
      locale: locale === 'vi' ? 'vi_VN' : 'en_US',
      alternateLocale: [locale === 'vi' ? 'en_US' : 'vi_VN'],
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image' as const,
      title,
      description,
      images: [image],
    },
  };
}

export function buildNewsArticleMetadata(
  locale: Locale,
  siteUrl: string,
  pathname: string,
  copy: NewsCopy,
  item: PublicNewsItem | null,
) {
  const safePath = pathname.startsWith('/news/') ? pathname : '/news';
  const canonical = absoluteUrl(siteUrl, canonicalPath(safePath, locale));
  const isPublished = Boolean(
    item &&
    !isNotPublished(item.status) &&
    !item.archivedAt &&
    !(item.expiresAt && Number.isFinite(Date.parse(item.expiresAt)) && Date.parse(item.expiresAt) <= Date.now()),
  );
  const title = isPublished
    ? cleanDescription(item?.title, 100) || cleanDescription(copy.title, 100)
    : cleanDescription(copy.notFoundTitle, 100);
  const description = isPublished
    ? cleanDescription(item?.summary, 200) || cleanDescription(item?.content, 200) || cleanDescription(copy.subtitle, 200)
    : cleanDescription(copy.notFoundBody, 200);
  const image = absoluteUrl(
    siteUrl,
    safeCoverUrl(isPublished ? item?.coverImageUrl : null) ?? localizedSocialImage(locale),
  );
  const publishedTime = isPublished ? item?.publishAt || item?.createdAt : undefined;

  return {
    metadataBase: new URL(normalizedSiteUrl(siteUrl)),
    title,
    description,
    alternates: {
      canonical,
      languages: languageAlternates(siteUrl, safePath),
    },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'article' as const,
      locale: locale === 'vi' ? 'vi_VN' : 'en_US',
      alternateLocale: [locale === 'vi' ? 'en_US' : 'vi_VN'],
      images: [{ url: image, width: 1200, height: 630, alt: title }],
      ...(publishedTime ? { publishedTime } : {}),
    },
    twitter: {
      card: 'summary_large_image' as const,
      title,
      description,
      images: [image],
    },
    ...(!isPublished ? { robots: { index: false, follow: false } } : {}),
  };
}

function rowsFrom(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.data)) return value.data.filter(isRecord);
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pathSegment(value: unknown) {
  if (typeof value !== 'string') return '';
  const segment = value.trim();
  return segment && segment.length <= 180 ? encodeURIComponent(segment) : '';
}

function parseDate(value: unknown, now: Date) {
  if (typeof value !== 'string' || !value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now.getTime() ? new Date(time) : undefined;
}

function addLocalizedSitemapEntry(
  entries: Map<string, ReturnType<typeof makeSitemapEntry>>,
  siteUrl: string,
  pathname: string,
  priority: number,
  lastModified?: Date,
) {
  const viPath = canonicalPath(pathname, 'vi');
  const entry = makeSitemapEntry(siteUrl, viPath, priority, lastModified, pathname);
  entries.set(entry.url, entry);
}

function makeSitemapEntry(
  siteUrl: string,
  pathname: string,
  priority: number,
  lastModified?: Date,
  alternatePath = pathname.replace(/^\/(en|vi)(?=\/|$)/, '') || '/',
) {
  return {
    url: absoluteUrl(siteUrl, pathname),
    ...(lastModified ? { lastModified } : {}),
    changeFrequency: 'weekly' as const,
    priority,
    alternates: {
      languages: languageAlternates(siteUrl, alternatePath),
    },
  };
}

export function shapePublicSitemap(
  siteUrl: string,
  newsResponse: unknown,
  docsResponse: unknown,
  now = new Date(),
) {
  const entries = new Map<string, ReturnType<typeof makeSitemapEntry>>();
  for (const [pathname, priority] of [
    ['/', 1],
    ['/news', 0.8],
    ['/docs', 0.7],
  ] as const) {
    if (pathname === '/') {
      entries.set(
        absoluteUrl(siteUrl, '/'),
        makeSitemapEntry(siteUrl, '/', priority, undefined, '/'),
      );
    }
    addLocalizedSitemapEntry(entries, siteUrl, pathname, priority);
    entries.set(
      absoluteUrl(siteUrl, canonicalPath(pathname, 'en')),
      makeSitemapEntry(siteUrl, canonicalPath(pathname, 'en'), priority, undefined, pathname),
    );
  }

  for (const item of rowsFrom(newsResponse) as PublicNewsItem[]) {
    if (
      isNotPublished(item.status) ||
      item.archivedAt ||
      (item.expiresAt && Number.isFinite(Date.parse(item.expiresAt)) && Date.parse(item.expiresAt) <= now.getTime())
    ) continue;
    const slug = pathSegment(item.slug || item.id);
    if (!slug) continue;
    addLocalizedSitemapEntry(
      entries,
      siteUrl,
      `/news/${slug}`,
      0.65,
      parseDate(item.updatedAt || item.publishAt || item.createdAt, now),
    );
  }

  for (const item of rowsFrom(docsResponse) as PublicDocumentItem[]) {
    const slug = pathSegment(item.slug);
    if (!slug) continue;
    addLocalizedSitemapEntry(
      entries,
      siteUrl,
      `/docs/${slug}`,
      0.55,
      parseDate(item.publishedAt, now),
    );
  }

  return [...entries.values()];
}
