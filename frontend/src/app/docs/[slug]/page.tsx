'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { publicDocsApi } from '@/lib/api';
import { ContentBackLink, PublicChrome } from '@/components/content/PublicChrome';
import { SectionEyebrow } from '@/components/ui/page-header';
import { LocalizedLink } from '@/components/LocalizedLink';
import { HomeNewsBentoSkeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/state-block';
import { campusErrorKind } from '@/lib/campus-error';
import { useI18n } from '@/i18n';
import { useApiQuery } from '@/lib/query';
import { sanitizeAnnouncementHtml } from '@/lib/html-sanitizer';
import { formatRelativeTime } from '@/lib/announcement-presentation';

/**
 * Public document detail (publication-policy §6): pinned to the published
 * revision; `?rev=n` follows the permalink contract — revisions beyond
 * `publishedRevision` answer 404 server-side, same as an unknown slug.
 */
export default function DocDetailPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = decodeURIComponent(params.slug ?? '');
  const revParam = searchParams.get('rev');
  const revision = revParam != null && /^\d+$/.test(revParam) ? Number(revParam) : null;
  const { locale, messages } = useI18n();
  const copy = messages.content.docs;

  const query = useApiQuery(
    ['public-doc', slug, revision],
    () => (revision != null
      ? publicDocsApi.revision(slug, revision)
      : publicDocsApi.detail(slug)),
    { enabled: slug.length > 0, retry: false },
  );
  const doc = query.data;
  const viewingSuperseded = doc != null && revision != null && doc.superseded;

  return (
    <PublicChrome>
      <ContentBackLink href="/docs" label={copy.backToList} />
      {query.isLoading ? (
        <HomeNewsBentoSkeleton />
      ) : query.isError && campusErrorKind(query.error) === 'notFound' ? (
        <div className="mt-8 rounded-xl border border-border bg-card p-10 text-center">
          <h1 className="text-2xl font-bold text-foreground">{copy.notFoundTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.notFoundBody}</p>
        </div>
      ) : query.isError ? (
        <ErrorState
          title={copy.loadErrorTitle}
          description={copy.loadError}
          onRetry={() => void query.refetch()}
        />
      ) : !doc ? (
        <div className="mt-8 rounded-xl border border-border bg-card p-10 text-center">
          <h1 className="text-2xl font-bold text-foreground">{copy.notFoundTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.notFoundBody}</p>
        </div>
      ) : (
        <article className="mt-6 max-w-3xl space-y-6">
          <header className="space-y-3">
            <SectionEyebrow>{copy.title}</SectionEyebrow>
            <h1 className="text-3xl font-bold leading-tight text-foreground">
              {locale === 'vi' ? doc.titleVi : doc.titleEn}
            </h1>
            <p className="text-sm text-muted-foreground">
              <time dateTime={doc.publishedAt}>
                {copy.publishedOn.replace('{date}', formatRelativeTime(doc.publishedAt, locale))}
              </time>
              {' · '}
              {copy.revisionLabel.replace('{revision}', String(revision ?? doc.publishedRevision))}
            </p>
            {viewingSuperseded ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                {copy.supersededNote.replace('{current}', String(doc.publishedRevision))}
                {' '}
                <LocalizedLink
                  href={`/docs/${encodeURIComponent(slug)}`}
                  className="font-semibold underline underline-offset-4"
                >
                  {copy.open}
                </LocalizedLink>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                <LocalizedLink
                  href={`/docs/${encodeURIComponent(slug)}?rev=${doc.publishedRevision}`}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {copy.permalinkLabel}
                </LocalizedLink>
              </p>
            )}
          </header>
          <div
            className="announcement-content text-base leading-7 text-foreground/90"
            aria-label={copy.bodyLabel}
            dangerouslySetInnerHTML={{
              __html: sanitizeAnnouncementHtml(locale === 'vi' ? doc.bodyVi : doc.bodyEn),
            }}
          />
        </article>
      )}
    </PublicChrome>
  );
}
