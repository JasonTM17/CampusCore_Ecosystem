'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { campusErrorKind } from '@/lib/campus-error';
import { statusToneClass, type StatusTone } from '@/components/ui/status';
import { libraryMessages } from '@/i18n/library-messages';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

type Copy = (typeof libraryMessages)['vi'];
const PAGE_SIZE = 20;

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
  const { locale, formatDateTime, messages } = useI18n();
  const copy = libraryMessages[locale];
  const [titles, setTitles] = useState<LibraryTitle[]>([]);
  const [loans, setLoans] = useState<LoanRequest[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  // A 401/403 on the catalogue read is a denial, not an outage.
  const [denied, setDenied] = useState(false);
  const requestSequence = useRef(0);
  const currentSelection = useRef<{ search: string | undefined; page: number }>({
    search: undefined,
    page: 0,
  });

  const load = useCallback(async (search?: string, requestedPage = 0) => {
    const requestId = ++requestSequence.current;
    currentSelection.current = { search, page: requestedPage };
    setIsLoading(true);
    setError('');
    setDenied(false);
    try {
      const [rows, mine] = await Promise.all([
        libraryApi.cataloguePage(search, requestedPage, PAGE_SIZE),
        libraryApi.myLoans(),
      ]);
      if (requestId !== requestSequence.current) return;

      let pageResult = rows;
      let resultPage = requestedPage;
      if (pageResult.items.length === 0 && resultPage > 0) {
        const lastPage = pageResult.total === null
          ? resultPage - 1
          : Math.max(0, Math.ceil(pageResult.total / PAGE_SIZE) - 1);
        resultPage = Math.min(resultPage - 1, lastPage);
        if (pageResult.total !== 0) {
          pageResult = await libraryApi.cataloguePage(search, resultPage, PAGE_SIZE);
          if (requestId !== requestSequence.current) return;
        }
      }
      if (pageResult.items.length === 0 && pageResult.total !== null && pageResult.total > 0) {
        setError(copy.failed);
        return;
      }

      setTitles(pageResult.items);
      setTotal(pageResult.total);
      setPage(resultPage);
      setLoans(mine);
      currentSelection.current = { search, page: resultPage };
    } catch (cause) {
      if (requestId !== requestSequence.current) return;
      const kind = campusErrorKind(cause);
      if (kind === 'forbidden' || kind === 'unauthorized') {
        setDenied(true);
      } else {
        setError(friendlyError(copy, cause));
      }
    } finally {
      if (requestId === requestSequence.current) setIsLoading(false);
    }
  }, [copy]);

  useEffect(() => {
    void load(undefined, 0);
  }, [load]);

  const search = () => {
    const selection = { search: query || undefined, page: 0 };
    currentSelection.current = selection;
    setPage(0);
    void load(selection.search, selection.page);
  };

  const loadCurrentSelection = () => load(
    currentSelection.current.search,
    currentSelection.current.page,
  );

  const goToPage = (nextPage: number) => {
    const selection = { search: currentSelection.current.search, page: nextPage };
    currentSelection.current = selection;
    void load(selection.search, selection.page);
  };

  const totalPages = total === null ? null : Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPreviousPage = page > 0;
  const hasNextPage = totalPages === null
    ? titles.length === PAGE_SIZE
    : page + 1 < totalPages;
  const firstVisible = titles.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastVisible = page * PAGE_SIZE + titles.length;
  const paginationSummary = total === null
    ? `${messages.common.states.showingResults} ${firstVisible} ${messages.common.states.to} ${lastVisible} ${messages.common.states.results}`
    : `${messages.common.states.showingResults} ${firstVisible} ${messages.common.states.to} ${lastVisible} ${messages.common.states.of} ${total} ${messages.common.states.results}`;

  const requestHold = async (copyId: string) => {
    setIsBusy(true);
    try {
      await libraryApi.request(copyId, newLibraryIdempotencyKey());
      toast.success(copy.requested);
      await loadCurrentSelection();
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
      await loadCurrentSelection();
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
        actions={<Button variant="outline" onClick={() => void loadCurrentSelection()}>{copy.refresh}</Button>}
      />

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
        data-testid="library-simulated-banner">
        {copy.simulatedBanner}
      </p>

      {error ? <ErrorState title={copy.failed} description={error} onRetry={() => void loadCurrentSelection()} /> : null}
      {denied ? <WorkspaceForbiddenState /> : null}

      <div className="flex gap-2">
        <Input
          data-testid="library-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchPlaceholder}
          onKeyDown={(event) => { if (event.key === 'Enter') search(); }}
        />
        <Button data-testid="library-search" variant="outline" onClick={search}>
          {copy.search}
        </Button>
      </div>

      {isLoading ? <LoadingState /> : null}

      {!isLoading && !error && !denied && titles.length === 0 ? (
        <EmptyState title={copy.emptyCatalogue} description="" />
      ) : null}

      {!isLoading && !error && !denied && titles.length > 0 ? (
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

      {!isLoading && !error && !denied ? (
        <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p role="status" aria-live="polite" data-testid="library-pagination-summary"
            className="text-sm text-muted-foreground">
            {paginationSummary}
          </p>
          {hasPreviousPage || hasNextPage ? (
            <nav aria-label={messages.common.states.page} className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={!hasPreviousPage}
                onClick={() => goToPage(page - 1)}>
                {messages.common.states.goToPreviousPage}
              </Button>
              <Button size="sm" variant="outline" disabled={!hasNextPage}
                onClick={() => goToPage(page + 1)}>
                {messages.common.states.goToNextPage}
              </Button>
            </nav>
          ) : null}
        </div>
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
