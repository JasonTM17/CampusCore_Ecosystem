import type { MetadataRoute } from 'next';
import { fetchPublicApiJson } from '@/lib/public-api-server';
import { shapePublicSitemap } from '@/lib/public-seo';
import { getSiteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

// The public list endpoints accept at most 100 rows per page. Walk every page
// up to a bounded maximum so a large catalog cannot make /sitemap.xml unbounded.
const PUBLIC_SITEMAP_PAGE_SIZE = 100;
const PUBLIC_SITEMAP_MAX_PAGES = 20;

function rowsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: unknown[] }).data;
  }
  return [];
}

function totalPagesOf(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const meta = (value as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object') return null;
  const totalPages = (meta as { totalPages?: unknown }).totalPages;
  return typeof totalPages === 'number' && Number.isFinite(totalPages) ? totalPages : null;
}

async function fetchSitemapRows(pathSegments: readonly string[]) {
  const rows: unknown[] = [];
  for (let page = 1; page <= PUBLIC_SITEMAP_MAX_PAGES; page += 1) {
    const response = await fetchPublicApiJson(pathSegments, {
      page: String(page),
      limit: String(PUBLIC_SITEMAP_PAGE_SIZE),
    });
    // A failed page must not break the sitemap: keep what was collected and
    // let the shaper add the static routes.
    if (response === null) break;
    const data = rowsOf(response);
    rows.push(...data);
    if (data.length === 0) break;
    const totalPages = totalPagesOf(response);
    if (totalPages !== null) {
      if (page >= totalPages) break;
    } else if (data.length < PUBLIC_SITEMAP_PAGE_SIZE) {
      break;
    }
  }
  return { data: rows };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [news, docs] = await Promise.all([
    fetchSitemapRows(['announcements', 'public']),
    fetchSitemapRows(['public', 'docs']),
  ]);

  return shapePublicSitemap(getSiteUrl(), news, docs) as MetadataRoute.Sitemap;
}
