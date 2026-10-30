import type { Metadata } from 'next';
import NewsListClient from './news-list-client';
import { getRequestLocale } from '@/i18n/server';
import { getMessages } from '@/i18n/messages';
import { buildNewsListMetadata } from '@/lib/public-seo';
import { getSiteUrl } from '@/lib/site';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return buildNewsListMetadata(
    locale,
    getSiteUrl(),
    getMessages(locale).content.news,
  );
}

export default function NewsPage() {
  return <NewsListClient />;
}
