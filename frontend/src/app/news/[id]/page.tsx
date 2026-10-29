import type { Metadata } from 'next';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { getRequestLocale } from '@/i18n/server';
import { fetchPublicApiJson } from '@/lib/public-api-server';
import { buildNewsArticleMetadata } from '@/lib/public-seo';
import { getSiteUrl } from '@/lib/site';
import NewsDetailClient from './news-detail-client';

type RouteProps = {
  params: Promise<{ id: string; locale?: string }>;
};

function publicNewsRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const payload = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : record;
  return payload;
}

function decodeRouteSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const route = await params;
  const locale = isLocale(route.locale) ? route.locale : await getRequestLocale();
  const idOrSlug = decodeRouteSegment(route.id ?? '');
  const response = idOrSlug.length > 0 && idOrSlug.length <= 180
    ? await fetchPublicApiJson(['announcements', 'public', idOrSlug])
    : null;

  return buildNewsArticleMetadata(
    locale,
    getSiteUrl(),
    `/news/${encodeURIComponent(idOrSlug)}`,
    getMessages(locale).content.news,
    publicNewsRecord(response),
  );
}

export default function NewsDetailPage() {
  return <NewsDetailClient />;
}
