'use client';

import { useParams } from 'next/navigation';
import { announcementsApi } from '@/lib/api';
import { ContentBackLink, PublicChrome } from '@/components/content/PublicChrome';
import { SectionEyebrow } from '@/components/ui/page-header';
import { HomeNewsBentoSkeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/i18n';
import { useApiQuery } from '@/lib/query';
import { sanitizeAnnouncementHtml } from '@/lib/html-sanitizer';
import {
  formatAnnouncementPublisher,
  formatRelativeTime,
} from '@/lib/announcement-presentation';

/**
 * Anonymous story detail (publication-policy §6): the backend answers 404 for
 * unpublished/unknown ids — there is no client-side existence oracle.
 */
export default function NewsDetailPage() {
  const params = useParams<{ id: string }>();
  const idOrSlug = decodeURIComponent(params.id ?? '');
  const { locale, messages } = useI18n();
  const copy = messages.content.news;

  const query = useApiQuery(
    ['public-news-detail', idOrSlug],
    () => announcementsApi.getPublicById(idOrSlug),
    { enabled: idOrSlug.length > 0, retry: false },
  );
  const item = query.data;

  return (
    <PublicChrome>
      <ContentBackLink href="/news" label={copy.backToList} />
      {query.isLoading ? (
        <HomeNewsBentoSkeleton />
      ) : query.isError || !item ? (
        <div className="mt-8 rounded-xl border border-border bg-card p-10 text-center">
          <h1 className="text-2xl font-bold text-foreground">{copy.notFoundTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.notFoundBody}</p>
        </div>
      ) : (
        <article className="mt-6 max-w-3xl space-y-6">
          <header className="space-y-3">
            <SectionEyebrow>{copy.title}</SectionEyebrow>
            <h1 className="text-3xl font-bold leading-tight text-foreground">{item.title}</h1>
            <p className="text-sm text-muted-foreground">
              <time dateTime={item.publishAt ?? item.createdAt}>
                {copy.publishedOn.replace('{date}', formatRelativeTime(item.publishAt ?? item.createdAt, locale))}
              </time>
              {' · '}
              {formatAnnouncementPublisher(item.lecturerDisplayName ?? item.publishedBy, locale)}
            </p>
          </header>
          <div
            className="announcement-content text-base leading-7 text-foreground/90"
            dangerouslySetInnerHTML={{ __html: sanitizeAnnouncementHtml(item.content ?? '') }}
          />
        </article>
      )}
    </PublicChrome>
  );
}
