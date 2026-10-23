'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRequireAuth } from '@/context/AuthContext';
import {
  libraryApi,
  newLibraryIdempotencyKey,
  type LibraryTitle,
  type LoanRequest,
} from '@/lib/library-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { statusToneClass, type StatusTone } from '@/components/ui/status';
import { libraryMessages } from '@/i18n/library-messages';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

type Copy = (typeof libraryMessages)['vi'];

const COPY_TONE: Record<string, StatusTone> = {
  AVAILABLE: 'success',
  RESERVED: 'warning',
  ON_LOAN: 'info',
  RETIRED: 'neutral',
};

const LOAN_TONE: Record<string, StatusTone> = {
  REQUESTED: 'warning',
  APPROVED: 'info',
  ISSUED: 'info',
  RETURNED: 'success',
  CANCELLED: 'neutral',
};

function isCancellable(loan: LoanRequest): boolean {
  return loan.status === 'REQUESTED' || loan.status === 'APPROVED';
}

function friendlyError(copy: Copy, error: unknown): string {
  const code = String(
    (error as { response?: { data?: { code?: string } } })?.response?.data?.code ?? '');
  if (code === 'COPY_UNAVAILABLE') return copy.copyUnavailable;
  return copy.failed;
}

/**
 * Patron library surface (contract §8, phase-11): catalogue search with
 * live availability, copy holds and own loan history. A hold request
 * flips the copy RESERVED server-side and carries a server-clock expiry;
 * availability on this page is always the server's answer, never a guess.
 */
export function LibraryCataloguePage() {
  const { isLoading: authLoading } = useRequireAuth();
  const { locale, formatDateTime } = useI18n();
  const copy = libraryMessages[locale];
  const [titles, setTitles] = useState<LibraryTitle[]>([]);
  const [loans, setLoans] = useState<LoanRequest[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (search?: string) => {
    setIsLoading(true);
    setError('');
    try {
      const [rows, mine] = await Promise.all([
        libraryApi.catalogue(search),
        libraryApi.myLoans(),
      ]);
      setTitles(rows);
      setLoans(mine);
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsLoading(false);
    }
  }, [copy]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestHold = async (copyId: string) => {
    setIsBusy(true);
    try {
      await libraryApi.request(copyId, newLibraryIdempotencyKey());
      toast.success(copy.requested);
      await load(query || undefined);
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsBusy(false);
    }
  };

  const cancel = async (loan: LoanRequest) => {
    setIsBusy(true);
    try {
      await libraryApi.cancel(loan.id, loan.version, newLibraryIdempotencyKey());
      toast.success(copy.cancelled);
      await load(query || undefined);
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsBusy(false);
    }
  };

  if (authLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-8" data-testid="library-catalogue-page">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
        title={copy.title}
        description={copy.description}
        actions={<Button variant="outline" onClick={() => void load(query || undefined)}>{copy.refresh}</Button>}
      />

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
        data-testid="library-simulated-banner">
        {copy.simulatedBanner}
      </p>

      {error ? <ErrorState title={copy.failed} description={error} /> : null}

      <div className="flex gap-2">
        <Input
          data-testid="library-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchPlaceholder}
          onKeyDown={(event) => { if (event.key === 'Enter') void load(query || undefined); }}
        />
        <Button data-testid="library-search" variant="outline" onClick={() => void load(query || undefined)}>
          {copy.search}
        </Button>
      </div>

      {isLoading ? <LoadingState /> : null}

      {!isLoading && titles.length === 0 ? (
        <EmptyState title={copy.emptyCatalogue} description="" />
      ) : null}

      {!isLoading && titles.length > 0 ? (
        <section className="space-y-4" data-testid="library-catalogue">
          {titles.map((title) => (
            <article key={title.id} className="rounded-lg border p-4" data-testid={`library-title-${title.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold">{title.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {[title.author, title.category, title.isbn].filter(Boolean).join(' • ')}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground" data-testid={`library-availability-${title.id}`}>
                  {copy.available}: {title.availableCopies}/{title.totalCopies}
                </span>
              </div>
              {title.copies.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {title.copies.map((item) => (
                    <li key={item.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                      data-testid={`library-copy-${item.id}`}>
                      <span>
                        {item.barcode}
                        <span className={cn('ml-2 rounded px-2 py-0.5 text-xs', statusToneClass(COPY_TONE[item.status] ?? 'neutral'))}>
                          {copy.copyStatusLabels[item.status] ?? item.status}
                        </span>
                      </span>
                      {item.status === 'AVAILABLE' ? (
                        <Button size="sm" variant="outline" disabled={isBusy}
                          data-testid={`library-request-${item.id}`}
                          onClick={() => void requestHold(item.id)}>
                          {copy.requestHold}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      <section className="space-y-3" data-testid="library-loans">
        <h2 className="text-lg font-semibold">{copy.myLoans}</h2>
        {loans.length === 0 ? <EmptyState title={copy.emptyLoans} description="" /> : null}
        {loans.map((loan) => (
          <article key={loan.id} className="rounded-lg border p-4" data-testid={`library-loan-${loan.id}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium">{loan.title ?? loan.barcode ?? loan.copyId}</h3>
                <p className="text-sm text-muted-foreground">
                  {loan.barcode}
                  {loan.expiresAt ? ` • ${copy.expiresAt}: ${formatDateTime(loan.expiresAt)}` : ''}
                  {loan.dueAt ? ` • ${copy.dueAt}: ${formatDateTime(loan.dueAt)}` : ''}
                  {loan.cancelReason ? ` • ${loan.cancelReason}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('rounded px-2 py-0.5 text-xs', statusToneClass(LOAN_TONE[loan.status] ?? 'neutral'))}
                  data-testid={`library-loan-status-${loan.id}`}>
                  {copy.statusLabels[loan.status] ?? loan.status}
                </span>
                {isCancellable(loan) ? (
                  <Button size="sm" variant="outline" disabled={isBusy}
                    data-testid={`library-cancel-${loan.id}`}
                    onClick={() => void cancel(loan)}>
                    {copy.cancel}
                  </Button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
