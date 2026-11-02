'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { publicDocsApi } from '@/lib/api';
import { LocalizedLink } from '@/components/LocalizedLink';
import { PublicChrome } from '@/components/content/PublicChrome';
import { SectionEyebrow } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HomeNewsBentoSkeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/state-block';
import { useI18n } from '@/i18n';
import { useApiQuery } from '@/lib/query';
import { clampPage, hasNextPage } from '@/lib/pager';
import { formatRelativeTime } from '@/lib/announcement-presentation';

const PAGE_SIZE = 50;

/**
 * Anonymous public-documentation lane (publication-policy §6): the server
 * runs the VI/EN diacritic-folded search over published revisions only.
 */
export default function DocsPage() {
  const { locale, messages } = useI18n();
  const copy = messages.content.docs;
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = useApiQuery(
    ['public-docs', search, page],
    () => publicDocsApi.list({ page, limit: PAGE_SIZE, search: search || undefined }),
  );
  const items = query.data?.data ?? [];
  const totalPages = Math.max(1, query.data?.meta?.totalPages ?? 1);
  useEffect(() => {
    if (!query.data || query.isFetching || query.isError) return;
    const correctedPage = clampPage(page, totalPages);
    if (correctedPage !== page) setPage(correctedPage);
  }, [page, query.data, query.isError, query.isFetching, totalPages]);
  const hasPreviousPage = page > 1;
  const goToPage = (nextPage: number) => setPage(clampPage(nextPage, totalPages));

  return (
    <PublicChrome>
      <div className="mb-8 space-y-2">
        <SectionEyebrow>CampusUTE</SectionEyebrow>
        <h1 className="text-3xl font-bold text-foreground">{copy.title}</h1>
        <p className="max-w-2xl text-base text-muted-foreground">{copy.subtitle}</p>
      </div>

      <form
        className="mb-8 flex max-w-xl gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
      >
        <Input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchAction}
          className="min-h-11"
        />
        <Button type="submit" className="min-h-11">
          <Search className="h-4 w-4" aria-hidden="true" />
          <span className="max-sm:sr-only">{copy.searchAction}</span>
        </Button>
      </form>

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
            const title = locale === 'vi' ? item.titleVi : item.titleEn;
            const summary = locale === 'vi' ? item.summaryVi : item.summaryEn;
            return (
              <li key={item.slug}>
                <article className="flex h-full min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-6 shadow-xs transition hover:border-primary/40 hover:shadow-md">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold uppercase tracking-wider">
                      {copy.revisionLabel.replace('{revision}', String(item.publishedRevision))}
                    </span>
                    <time dateTime={item.publishedAt}>{formatRelativeTime(item.publishedAt, locale)}</time>
                  </div>
                  <h2 className="text-lg font-semibold leading-snug text-foreground">{title}</h2>
                  {summary ? (
                    <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{summary}</p>
                  ) : null}
                  <LocalizedLink
                    href={`/docs/${encodeURIComponent(item.slug)}`}
                    className="group mt-auto inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {copy.open}
                    <ArrowRight className="h-4 w-4 transition-transform duration-150 motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
                  </LocalizedLink>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {!query.isLoading && !query.isError && items.length > 0 ? (
        <div className="mt-8 flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {messages.common.states.page} {page} / {totalPages}
          </p>
          {hasPreviousPage || hasNextPage(page, totalPages) ? (
            <nav aria-label={messages.common.states.page} className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!hasPreviousPage}
                onClick={() => goToPage(page - 1)}
              >
                {messages.common.states.goToPreviousPage}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!hasNextPage(page, totalPages)}
                onClick={() => goToPage(page + 1)}
              >
                {messages.common.states.goToNextPage}
              </Button>
            </nav>
          ) : null}
        </div>
      ) : null}
    </PublicChrome>
  );
}
