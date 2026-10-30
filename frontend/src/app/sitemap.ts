import type { MetadataRoute } from 'next';
import { fetchPublicApiJson } from '@/lib/public-api-server';
import { shapePublicSitemap } from '@/lib/public-seo';
import { getSiteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [news, docs] = await Promise.all([
    fetchPublicApiJson(['announcements', 'public'], { page: '1', limit: '50' }),
    fetchPublicApiJson(['public', 'docs'], { page: '1', limit: '50' }),
  ]);

  return shapePublicSitemap(getSiteUrl(), news, docs) as MetadataRoute.Sitemap;
}
