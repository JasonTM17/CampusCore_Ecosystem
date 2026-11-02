'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRequireAuth } from '@/context/AuthContext';
import {
  libraryApi,
  type LoanRequest,
  type LoanStatus,
} from '@/lib/library-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/components/ui/state-block';
import { LinkButton } from '@/components/ui/link-button';
import { campusErrorKind } from '@/lib/campus-error';
import { statusToneClass, type StatusTone } from '@/components/ui/status';
import { libraryMessages } from '@/i18n/library-messages';
import { useI18n } from '@/i18n';
import {
  correctEmptyPage,
  createSequenceGuard,
  hasNextPage as hasNextPageFor,
  pageCount,
} from '@/lib/array-list-page';
import { cn } from '@/lib/utils';

type Copy = (typeof libraryMessages)['vi'];
const PAGE_SIZE = 20;

const LOAN_TONE: Record<string, StatusTone> = {
  REQUESTED: 'warning',
  APPROVED: 'info',
  ISSUED: 'info',
  RETURNED: 'success',
  CANCELLED: 'neutral',
};

const FILTERS: Array<LoanStatus | ''> = ['', 'REQUESTED', 'APPROVED', 'ISSUED', 'RETURNED', 'CANCELLED'];

function friendlyError(copy: Copy, error: unknown): string {
  const code = String(
    (error as { response?: { data?: { code?: string } } })?.response?.data?.code ?? '');
  if (code === 'LIBRARY_STAFF_REQUIRED') return copy.staffRequired;
  return copy.failed;
}

/**
 * Staff circulation desk (contract §8, phase-11): approve holds inside
 * their server-clock window, issue copies (RESERVED → ON_LOAN), take
 * returns (stock restored in the same transaction) and cancel pre-issue
 * holds. STAFF:library grants are enforced server-side — this page only
 * surfaces the result.
 */
export function LibraryDeskPage() {
  const { isLoading: authLoading } = useRequireAuth();
  const { locale, formatDateTime, messages } = useI18n();
  const copy = libraryMessages[locale];
  const [loans, setLoans] = useState<LoanRequest[]>([]);
  const [filter, setFilter] = useState<LoanStatus | ''>('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  // The circulation desk is staff-only; a denied queue read gets its own
  // state instead of a retryable error.
  const [denied, setDenied] = useState(false);
  const requestSequence = useRef(createSequenceGuard());
  const currentSelection = useRef<{ status: LoanStatus | ''; page: number }>({
    status: '',
    page: 0,
  });

  const load = useCallback(async (
    status: LoanStatus | '' = currentSelection.current.status,
    requestedPage: number = currentSelection.current.page,
  ) => {
    const requestId = requestSequence.current.begin();
    currentSelection.current = { status, page: requestedPage };
    setIsLoading(true);
    setError('');
    setDenied(false);
    // The request token fences late responses; the requested page is checked
    // too so a response for a page the reader already left can never land.
    const selectionMatches = () =>
      currentSelection.current.status === status
      && currentSelection.current.page === requestedPage;
    try {
      let result = await libraryApi.queuePage(status || undefined, requestedPage, PAGE_SIZE);
      if (!requestSequence.current.isCurrent(requestId) || !selectionMatches()) return;

      let resultPage = requestedPage;
      const correction = correctEmptyPage(requestedPage, result, PAGE_SIZE);
      if (correction) {
        resultPage = correction.page;
        if (correction.refetch) {
          result = await libraryApi.queuePage(status || undefined, resultPage, PAGE_SIZE);
          if (!requestSequence.current.isCurrent(requestId) || !selectionMatches()) return;
        }
      }
      if (result.items.length === 0 && result.total !== undefined && result.total > 0) {
        setError(copy.failed);
        return;
      }

      setLoans(result.items);
      setTotal(result.total ?? null);
      setPage(resultPage);
      currentSelection.current = { status, page: resultPage };
    } catch (cause) {
      if (!requestSequence.current.isCurrent(requestId) || !selectionMatches()) return;
      const kind = campusErrorKind(cause);
      if (kind === 'forbidden' || kind === 'unauthorized') {
        setDenied(true);
      } else {
        setError(friendlyError(copy, cause));
      }
    } finally {
      if (requestSequence.current.isCurrent(requestId)) setIsLoading(false);
    }
  }, [copy]);

  useEffect(() => {
    void load('', 0);
  }, [load]);

  const reloadCurrent = useCallback(
    () => load(currentSelection.current.status, currentSelection.current.page),
    [load],
  );

  const changeFilter = (nextFilter: LoanStatus | '') => {
    setFilter(nextFilter);
    setPage(0);
    void load(nextFilter, 0);
  };

  const goToPage = (nextPage: number) => {
    void load(currentSelection.current.status, nextPage);
  };

  const act = async (action: () => Promise<LoanRequest>, done: string) => {
    setIsBusy(true);
    try {
      await action();
      toast.success(done);
      await reloadCurrent();
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsBusy(false);
    }
  };

  const totalPages = pageCount(total ?? undefined, PAGE_SIZE);
  const hasPreviousPage = page > 0;
  const hasNextPage = hasNextPageFor(page, totalPages, loans.length, PAGE_SIZE);
  const firstVisible = loans.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastVisible = page * PAGE_SIZE + loans.length;
  const paginationSummary = total === null
    ? `${messages.common.states.showingResults} ${firstVisible} ${messages.common.states.to} ${lastVisible} ${messages.common.states.results}`
    : `${messages.common.states.showingResults} ${firstVisible} ${messages.common.states.to} ${lastVisible} ${messages.common.states.of} ${total} ${messages.common.states.results}`;

  if (authLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-8" data-testid="library-desk-page">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.deskEyebrow}</SectionEyebrow>}
        title={copy.deskTitle}
        description={copy.deskDescription}
        actions={<Button variant="outline" onClick={() => void reloadCurrent()}>{copy.refresh}</Button>}
      />

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
        data-testid="library-simulated-banner">
        {copy.simulatedBanner}
      </p>

      {error ? <ErrorState title={copy.failed} description={error} onRetry={() => void reloadCurrent()} /> : null}
      {denied ? (
        <ForbiddenState
          title={copy.staffRequired}
          description=""
          action={(
            <LinkButton href="/dashboard" variant="outline">
              {messages.common.actions.openDashboard}
            </LinkButton>
          )}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((value) => (
          <Button
            key={value || 'all'}
            size="sm"
            variant={filter === value ? 'default' : 'outline'}
            data-testid={value ? `library-filter-${value}` : 'library-filter-all'}
            onClick={() => changeFilter(value)}>
            {value === '' ? copy.filterAll : (copy.statusLabels[value] ?? value)}
          </Button>
        ))}
        <Input
          className="ml-auto max-w-xs"
          data-testid="library-cancel-reason"
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          placeholder={copy.cancelReasonPlaceholder}
        />
      </div>

      {isLoading ? <LoadingState /> : null}

      {!isLoading && !error && !denied && loans.length === 0 ? <EmptyState title={copy.queueEmpty} description="" /> : null}

      {!isLoading && !error && !denied && loans.length > 0 ? (
        <section className="space-y-3" data-testid="library-queue">
          {loans.map((loan) => (
            <article key={loan.id} className="rounded-lg border p-4"
              data-testid={`library-request-${loan.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{loan.title ?? loan.copyId}</h3>
                  <p className="text-sm text-muted-foreground">
                    {copy.borrower}: {loan.borrowerEmail ?? loan.borrowerUserId}
                    {' • '}{copy.copy}: {loan.barcode ?? loan.copyId}
                    {loan.expiresAt ? ` • ${copy.expiresAt}: ${formatDateTime(loan.expiresAt)}` : ''}
                    {loan.dueAt ? ` • ${copy.dueAt}: ${formatDateTime(loan.dueAt)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded px-2 py-0.5 text-xs', statusToneClass(LOAN_TONE[loan.status] ?? 'neutral'))}
                    data-testid={`library-request-status-${loan.id}`}>
                    {copy.statusLabels[loan.status] ?? loan.status}
                  </span>
                  {loan.status === 'REQUESTED' ? (
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`library-approve-${loan.id}`}
                      onClick={() => void act(
                        () => libraryApi.approve(loan.id, loan.version), copy.approvedOk)}>
                      {copy.approve}
                    </Button>
                  ) : null}
                  {loan.status === 'APPROVED' ? (
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`library-issue-${loan.id}`}
                      onClick={() => void act(
                        () => libraryApi.issue(loan.id, loan.version), copy.issuedOk)}>
                      {copy.issue}
                    </Button>
                  ) : null}
                  {loan.status === 'ISSUED' ? (
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`library-return-${loan.id}`}
                      onClick={() => void act(
                        () => libraryApi.returnLoan(loan.id, loan.version), copy.returnedOk)}>
                      {copy.returnLoan}
                    </Button>
                  ) : null}
                  {loan.status === 'REQUESTED' || loan.status === 'APPROVED' ? (
                    <Button size="sm" variant="destructive" disabled={isBusy}
                      data-testid={`library-cancel-staff-${loan.id}`}
                      onClick={() => void act(
                        () => libraryApi.cancelStaff(loan.id, loan.version, cancelReason || undefined),
                        copy.cancelledStaffOk)}>
                      {copy.cancelStaff}
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {!isLoading && !error && !denied ? (
        <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p role="status" aria-live="polite" data-testid="library-desk-pagination-summary"
            className="text-sm text-muted-foreground">
            {paginationSummary}
            <span className="ml-2">
              {messages.common.states.page} {page + 1}
              {totalPages === undefined ? '' : ` / ${totalPages}`}
            </span>
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
    </div>
  );
}
