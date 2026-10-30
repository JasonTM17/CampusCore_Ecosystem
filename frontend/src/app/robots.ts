import type { MetadataRoute } from 'next';
import { buildSiteUrl, getSiteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/en/',
          '/vi/',
          '/login',
          '/en/login',
          '/vi/login',
          '/icon.svg',
          '/icon.png',
          '/favicon.ico',
        ],
        disallow: [
          '/admin/',
          '/dashboard/',
          '/en/admin/',
          '/vi/admin/',
          '/en/dashboard/',
          '/vi/dashboard/',
          // The account-issuance notice is user guidance, not a landing page.
          '/register',
          '/en/register',
          '/vi/register',
          // Reset links carry single-use credentials in the query string;
          // keep them out of indexes entirely.
          '/reset-password',
          '/en/reset-password',
          '/vi/reset-password',
          // Check-in deep links hand off to the CampusUTE app; session ids
          // must never reach a search index.
          '/attendance/checkin/',
          '/en/attendance/checkin/',
          '/vi/attendance/checkin/',
          // The staff desk start page is a gated surface like the desks it
          // links to.
          '/staff',
          '/en/staff',
          '/vi/staff',
          '/api/',
          '/_next/',
        ],
      },
    ],
    sitemap: buildSiteUrl('/sitemap.xml'),
    host: getSiteUrl(),
  };
}

