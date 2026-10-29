'use client';

import { ArrowRight } from 'lucide-react';
import { announcementsApi, type AnnouncementRecord } from '@/lib/api';
import { LocalizedLink } from '@/components/LocalizedLink';
import { PublicChrome } from '@/components/content/PublicChrome';
import { SectionEyebrow } from '@/components/ui/page-header';
import { HomeNewsBentoSkeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/state-block';
import { useI18n } from '@/i18n';
import { useApiQuery } from '@/lib/query';
import {
  extractAnnouncementExcerpt,
  formatAnnouncementPublisher,
  formatRelativeTime,
} from '@/lib/announcement-presentation';

/**
 * Anonymous campus news feed (publication-policy §6): only rows the backend
 * already scoped to `status=PUBLISHED AND archivedAt IS NULL` arrive here.
 */
export default function NewsPage() {
  const { locale, messages } = useI18n();
  const copy = messages.content.news;
  const query = useApiQuery(
    ['public-news'],
    () => announcementsApi.getPublic({ page: 1, limit: 50 }),
  );
  const items = (query.data?.data ?? []) as AnnouncementRecord[];

  return (
    <PublicChrome>
      <div className="mb-8 space-y-2">
        <SectionEyebrow>CampusUTE</SectionEyebrow>
        <h1 className="text-3xl font-bold text-foreground">{copy.title}</h1>
        <p className="max-w-2xl text-base text-muted-foreground">{copy.subtitle}</p>
      </div>

      {query.isLoading ? (
        <HomeNewsBentoSkeleton />
      ) : query.isError ? (
        <ErrorState
          title={copy.loadErrorTitle}
          description={copy.loadError}
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {copy.empty}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const href = `/news/${encodeURIComponent(item.slug || item.id)}`;
            const priorityLabel =
              copy.priority[(item.priority as keyof typeof copy.priority) || 'NORMAL']
              ?? item.priority;
            return (
              <li key={item.id}>
                <article className="flex h-full min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-6 shadow-xs transition hover:border-primary/40 hover:shadow-md">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold uppercase tracking-wider">{priorityLabel}</span>
                    <time dateTime={item.publishAt ?? item.createdAt}>
                      {formatRelativeTime(item.publishAt ?? item.createdAt, locale)}
                    </time>
                  </div>
                  <h2 className="text-lg font-semibold leading-snug text-foreground">
                    {item.title}
                  </h2>
                  <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                    {item.summary || extractAnnouncementExcerpt(item.content, 160)}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {formatAnnouncementPublisher(
                        item.lecturerDisplayName ?? item.publishedBy,
                        locale,
                      )}
                    </span>
                    <LocalizedLink
                      href={href}
                      className="group inline-flex min-h-10 shrink-0 items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {copy.readMore}
                      <ArrowRight className="h-4 w-4 transition-transform duration-150 motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
                    </LocalizedLink>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </PublicChrome>
  );
}
