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
          // Recovery is a uniform-response entry point, never a search
          // landing page.
          '/forgot-password',
          '/en/forgot-password',
          '/vi/forgot-password',
          // Staff desks: authenticated consoles with no public content. They
          // mirror STAFF_DESKS (admissions / careers / library); the events and
          // admin consoles already sit under '/admin/'. The bare path already
          // covers its subtree, the trailing-slash form is kept explicit for
          // readers grepping the canonical desk URL.
          '/apply/review',
          '/apply/review/',
          '/en/apply/review',
          '/vi/apply/review',
          '/careers/desk',
          '/careers/desk/',
          '/en/careers/desk',
          '/vi/careers/desk',
          '/library/desk',
          '/library/desk/',
          '/en/library/desk',
          '/vi/library/desk',
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

