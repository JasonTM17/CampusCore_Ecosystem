'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { statusToneClass, type StatusTone } from '@/components/ui/status';
import { libraryMessages } from '@/i18n/library-messages';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

type Copy = (typeof libraryMessages)['vi'];

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
  const { locale, formatDateTime } = useI18n();
  const copy = libraryMessages[locale];
  const [loans, setLoans] = useState<LoanRequest[]>([]);
  const [filter, setFilter] = useState<LoanStatus | ''>('');
  const [cancelReason, setCancelReason] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (status?: LoanStatus | '') => {
    setIsLoading(true);
    setError('');
    try {
      setLoans(await libraryApi.queue(status || undefined));
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsLoading(false);
    }
  }, [copy]);

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  const act = async (action: () => Promise<LoanRequest>, done: string) => {
    setIsBusy(true);
    try {
      await action();
      toast.success(done);
      await load(filter);
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
    <div className="space-y-8" data-testid="library-desk-page">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.deskEyebrow}</SectionEyebrow>}
        title={copy.deskTitle}
        description={copy.deskDescription}
        actions={<Button variant="outline" onClick={() => void load(filter)}>{copy.refresh}</Button>}
      />

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
        data-testid="library-simulated-banner">
        {copy.simulatedBanner}
      </p>

      {error ? <ErrorState title={copy.failed} description={error} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((value) => (
          <Button
            key={value || 'all'}
            size="sm"
            variant={filter === value ? 'default' : 'outline'}
            data-testid={value ? `library-filter-${value}` : 'library-filter-all'}
            onClick={() => setFilter(value)}>
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

      {!isLoading && loans.length === 0 ? <EmptyState title={copy.queueEmpty} description="" /> : null}

      {!isLoading && loans.length > 0 ? (
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
    </div>
  );
}
