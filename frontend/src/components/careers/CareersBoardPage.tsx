'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRequireAuth } from '@/context/AuthContext';
import {
  careersApi,
  newCareerIdempotencyKey,
  type CareerApplication,
  type CareerOpportunity,
} from '@/lib/careers-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { campusErrorKind } from '@/lib/campus-error';
import { UPLOAD_ACCEPT_DOCUMENTS, validateUploadFile } from '@/lib/upload-validation';
import { statusToneClass, type StatusTone } from '@/components/ui/status';
import { careerMessages } from '@/i18n/careers-messages';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

type Copy = (typeof careerMessages)['vi'];
const PAGE_SIZE = 20;

const OPPORTUNITY_TONE: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'warning',
  PUBLISHED: 'success',
  PAUSED: 'warning',
  CLOSED: 'neutral',
  REJECTED: 'danger',
};

const APPLICATION_TONE: Record<string, StatusTone> = {
  SUBMITTED: 'warning',
  REVIEWING: 'info',
  INTERVIEW: 'info',
  OFFER: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};

function isWithdrawable(application: CareerApplication): boolean {
  return ['SUBMITTED', 'REVIEWING', 'INTERVIEW', 'OFFER'].includes(application.status);
}

function friendlyError(copy: Copy, error: unknown): string {
  const code = String(
    (error as { response?: { data?: { code?: string } } })?.response?.data?.code
    ?? (error as { code?: string })?.code
    ?? '');
  if (code === 'UPLOAD_TOO_LARGE') return copy.uploadTooLarge;
  if (code === 'UPLOAD_TYPE_UNSUPPORTED') return copy.uploadTypeUnsupported;
  if (code === 'APPLICATION_ACTIVE') return copy.alreadyApplied;
  if (code === 'OPPORTUNITY_NOT_OPEN') return copy.notOpen;
  return copy.failed;
}

/**
 * Candidate careers surface (contract §9, phase-12): browse PUBLISHED
 * postings, apply with a cover letter, upload attachments, withdraw a
 * pre-terminal application. Foreign application ids answer the same
 * APPLICATION_NOT_FOUND a missing id does — candidate isolation is
 * server-side truth.
 */
export function CareersBoardPage() {
  const { isLoading: authLoading } = useRequireAuth();
  const { locale, formatDateTime, messages } = useI18n();
  const copy = careerMessages[locale];
  const [opportunities, setOpportunities] = useState<CareerOpportunity[]>([]);
  const [applications, setApplications] = useState<CareerApplication[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [coverLetters, setCoverLetters] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  // A 401/403 on the board read is a denial, not an outage.
  const [denied, setDenied] = useState(false);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
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
        careersApi.opportunitiesPage(search, requestedPage, PAGE_SIZE),
        careersApi.myApplications(),
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
          pageResult = await careersApi.opportunitiesPage(search, resultPage, PAGE_SIZE);
          if (requestId !== requestSequence.current) return;
        }
      }
      if (pageResult.items.length === 0 && pageResult.total !== null && pageResult.total > 0) {
        setError(copy.failed);
        return;
      }

      setOpportunities(pageResult.items);
      setTotal(pageResult.total);
      setPage(resultPage);
      setApplications(mine);
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
    ? opportunities.length === PAGE_SIZE
    : page + 1 < totalPages;
  const firstVisible = opportunities.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastVisible = page * PAGE_SIZE + opportunities.length;
  const paginationSummary = total === null
    ? `${messages.common.states.showingResults} ${firstVisible} ${messages.common.states.to} ${lastVisible} ${messages.common.states.results}`
    : `${messages.common.states.showingResults} ${firstVisible} ${messages.common.states.to} ${lastVisible} ${messages.common.states.of} ${total} ${messages.common.states.results}`;

  const appliedOpportunityIds = new Set(
    applications
      .filter((application) => isWithdrawable(application))
      .map((application) => application.opportunityId));

  const apply = async (opportunityId: string) => {
    setIsBusy(true);
    try {
      await careersApi.apply(opportunityId,
        coverLetters[opportunityId] ?? '', newCareerIdempotencyKey());
      toast.success(copy.applied);
      setCoverLetters((current) => ({ ...current, [opportunityId]: '' }));
      await loadCurrentSelection();
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsBusy(false);
    }
  };

  const withdraw = async (application: CareerApplication) => {
    setIsBusy(true);
    try {
      await careersApi.withdraw(application.id, application.version,
        newCareerIdempotencyKey());
      toast.success(copy.withdrawn);
      await loadCurrentSelection();
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsBusy(false);
    }
  };

  const upload = async (application: CareerApplication, file: File | undefined,
      input: HTMLInputElement | null) => {
    if (!file) return;
    // Rejected picks are dropped from the input immediately so the same file
    // can be chosen again and still fire onChange.
    const rejection = validateUploadFile(file, 'documents');
    if (rejection) {
      toast.error(rejection === 'too-large' ? copy.uploadTooLarge : copy.uploadTypeUnsupported);
      if (input) input.value = '';
      return;
    }
    setIsBusy(true);
    try {
      await careersApi.uploadAttachment(application.id, file, newCareerIdempotencyKey());
      toast.success(copy.uploaded);
      // Only a successful upload clears the input: on failure the picked file
      // stays selected so the candidate does not have to re-pick it.
      if (input) input.value = '';
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
    <div className="space-y-8" data-testid="careers-board-page">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
        title={copy.title}
        description={copy.description}
        actions={<Button variant="outline" onClick={() => void loadCurrentSelection()}>{copy.refresh}</Button>}
      />

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
        data-testid="careers-simulated-banner">
        {copy.simulatedBanner}
      </p>

      {error ? <ErrorState title={copy.failed} description={error} onRetry={() => void loadCurrentSelection()} /> : null}
      {denied ? <WorkspaceForbiddenState /> : null}

      <div className="flex gap-2">
        <Input
          data-testid="careers-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchPlaceholder}
          onKeyDown={(event) => { if (event.key === 'Enter') search(); }}
        />
        <Button data-testid="careers-search" variant="outline" onClick={search}>
          {copy.search}
        </Button>
      </div>

      {isLoading ? <LoadingState /> : null}

      {!isLoading && !error && !denied && opportunities.length === 0 ? (
        <EmptyState title={copy.emptyBoard} description="" />
      ) : null}

      {!isLoading && !error && !denied && opportunities.length > 0 ? (
        <section className="space-y-4" data-testid="careers-board">
          {opportunities.map((opportunity) => (
            <article key={opportunity.id} className="rounded-lg border p-4"
              data-testid={`careers-opp-${opportunity.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold">{opportunity.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {[opportunity.organizationName, opportunity.location,
                      opportunity.employmentType, opportunity.salaryText]
                      .filter(Boolean).join(' • ')}
                  </p>
                </div>
                <span className={cn('rounded px-2 py-0.5 text-xs',
                  statusToneClass(OPPORTUNITY_TONE[opportunity.status] ?? 'neutral'))}
                  data-testid={`careers-opp-status-${opportunity.id}`}>
                  {copy.opportunityStatusLabels[opportunity.status] ?? opportunity.status}
                </span>
              </div>
              {opportunity.description ? (
                <p className="mt-2 text-sm text-muted-foreground">{opportunity.description}</p>
              ) : null}
              {appliedOpportunityIds.has(opportunity.id) ? null : (
                <div className="mt-3 space-y-2">
                  <Input
                    data-testid={`careers-cover-${opportunity.id}`}
                    value={coverLetters[opportunity.id] ?? ''}
                    onChange={(event) => setCoverLetters((current) => ({
                      ...current, [opportunity.id]: event.target.value,
                    }))}
                    placeholder={copy.coverLetterPlaceholder}
                  />
                  <Button size="sm" variant="outline" disabled={isBusy}
                    data-testid={`careers-apply-${opportunity.id}`}
                    onClick={() => void apply(opportunity.id)}>
                    {copy.apply}
                  </Button>
                </div>
              )}
            </article>
          ))}
        </section>
      ) : null}

      {!isLoading && !error && !denied ? (
        <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p role="status" aria-live="polite" data-testid="careers-pagination-summary"
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

      <section className="space-y-3" data-testid="careers-applications">
        <h2 className="text-lg font-semibold">{copy.myApplications}</h2>
        {applications.length === 0 ? (
          <EmptyState title={copy.emptyApplications} description="" />
        ) : null}
        {applications.map((application) => (
          <article key={application.id} className="rounded-lg border p-4"
            data-testid={`careers-app-${application.id}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium">
                  {application.opportunityTitle ?? application.opportunityId}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {application.organizationName}
                  {application.submittedAt
                    ? ` • ${copy.submittedAt}: ${formatDateTime(application.submittedAt)}`
                    : ''}
                </p>
                {application.moderationReason ? (
                  <p className="mt-1 text-sm text-red-600"
                    data-testid={`careers-app-reason-${application.id}`}>
                    {copy.moderationReason}: {application.moderationReason}
                  </p>
                ) : null}
                {application.attachments.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {copy.attachments}: {application.attachments
                      .map((attachment) => attachment.fileName).join(', ')}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('rounded px-2 py-0.5 text-xs',
                  statusToneClass(APPLICATION_TONE[application.status] ?? 'neutral'))}
                  data-testid={`careers-app-status-${application.id}`}>
                  {copy.applicationStatusLabels[application.status] ?? application.status}
                </span>
                {isWithdrawable(application) ? (
                  <>
                    <input type="file" hidden accept={UPLOAD_ACCEPT_DOCUMENTS}
                      ref={(element) => { fileInputs.current[application.id] = element; }}
                      onChange={(event) => {
                        // Do not clear the input here: upload() owns the
                        // clearing so a failed request keeps the picked file.
                        void upload(application, event.target.files?.[0], event.target);
                      }} />
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`careers-upload-${application.id}`}
                      onClick={() => {
                        const input = fileInputs.current[application.id];
                        if (!input) return;
                        // Reset before opening the picker so choosing the same
                        // file again still fires onChange (retry path).
                        input.value = '';
                        input.click();
                      }}>
                      {copy.uploadAttachment}
                    </Button>
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`careers-withdraw-${application.id}`}
                      onClick={() => void withdraw(application)}>
                      {copy.withdraw}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
