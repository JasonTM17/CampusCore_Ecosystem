'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRequireAuth } from '@/context/AuthContext';
import {
  careersApi,
  type ApplicationStep,
  type CareerApplication,
  type CareerOpportunity,
  type CareerOrganization,
} from '@/lib/careers-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/components/ui/state-block';
import { LinkButton } from '@/components/ui/link-button';
import { campusErrorKind } from '@/lib/campus-error';
import { statusToneClass, type StatusTone } from '@/components/ui/status';
import { careerMessages } from '@/i18n/careers-messages';
import { useI18n } from '@/i18n';
import {
  correctEmptyPage,
  createSequenceGuard,
  hasNextPage,
  pageCount,
} from '@/lib/array-list-page';
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

const NEXT_STEP: Record<string, { step: ApplicationStep; label: keyof Copy }> = {
  SUBMITTED: { step: 'REVIEWING', label: 'toReviewing' },
  REVIEWING: { step: 'INTERVIEW', label: 'toInterview' },
  INTERVIEW: { step: 'OFFER', label: 'toOffer' },
};

function errorCode(error: unknown): string {
  return String(
    (error as { response?: { data?: { code?: string } } })?.response?.data?.code ?? '');
}

/**
 * One desk pager for every section: the same role/status and navigation
 * pattern used by the public news/docs lists, driven by zero-based state but
 * labelled one-based.
 */
function DeskPager(props: {
  testId: string;
  page: number;
  total: number | null;
  itemCount: number;
  summary: string;
  previousLabel: string;
  nextLabel: string;
  navLabel: string;
  onPage: (nextPage: number) => void;
}) {
  const totalPages = pageCount(props.total ?? undefined, PAGE_SIZE);
  const hasPrevious = props.page > 0;
  const hasNext = hasNextPage(props.page, totalPages, props.itemCount, PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p role="status" aria-live="polite" data-testid={`${props.testId}-summary`}
        className="text-sm text-muted-foreground">
        {props.summary}
        <span className="ml-2">
          {props.navLabel} {props.page + 1}
          {totalPages === undefined ? '' : ` / ${totalPages}`}
        </span>
      </p>
      {hasPrevious || hasNext ? (
        <nav aria-label={props.navLabel} className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!hasPrevious}
            onClick={() => props.onPage(props.page - 1)}>
            {props.previousLabel}
          </Button>
          <Button size="sm" variant="outline" disabled={!hasNext}
            onClick={() => props.onPage(props.page + 1)}>
            {props.nextLabel}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

/**
 * Staff careers surface (contract §9, phase-12): the org-recruiter lane
 * (create/submit-review/pause/resume/close postings, review applications
 * inside granted organizations only) plus the platform reviewer lane
 * (IN_REVIEW → PUBLISHED/REJECTED, never on the reviewer's own
 * submission). Every scope check is enforced server-side; this page only
 * renders what the API returns. Each queue keeps its own page window.
 */
export function CareersDeskPage() {
  const { isLoading: authLoading } = useRequireAuth();
  const { locale, formatDateTime, messages } = useI18n();
  const copy = careerMessages[locale];
  const [organizations, setOrganizations] = useState<CareerOrganization[]>([]);
  const [opportunities, setOpportunities] = useState<CareerOpportunity[]>([]);
  const [reviewQueue, setReviewQueue] = useState<CareerOpportunity[]>([]);
  const [applications, setApplications] = useState<CareerApplication[]>([]);
  const [isRecruiter, setIsRecruiter] = useState(false);
  const [isReviewer, setIsReviewer] = useState(false);
  const [title, setTitle] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  // Staff/reviewer denials get a forbidden state with a way back rather than
  // being read as a transient failure.
  const [denied, setDenied] = useState(false);

  const [opportunityPage, setOpportunityPage] = useState(0);
  const [opportunityTotal, setOpportunityTotal] = useState<number | null>(null);
  const [applicationPage, setApplicationPage] = useState(0);
  const [applicationTotal, setApplicationTotal] = useState<number | null>(null);
  const [reviewPage, setReviewPage] = useState(0);
  const [reviewTotal, setReviewTotal] = useState<number | null>(null);

  const opportunitySequence = useRef(createSequenceGuard());
  const applicationSequence = useRef(createSequenceGuard());
  const reviewSequence = useRef(createSequenceGuard());
  const currentOpportunitySelection = useRef(0);
  const currentApplicationSelection = useRef(0);
  const currentReviewSelection = useRef(0);

  const loadOpportunities = useCallback(async (requestedPage: number) => {
    const requestId = opportunitySequence.current.begin();
    currentOpportunitySelection.current = requestedPage;
    setError('');
    try {
      let result = await careersApi.opportunityQueuePage(undefined, requestedPage, PAGE_SIZE);
      if (!opportunitySequence.current.isCurrent(requestId)) return;

      let resultPage = requestedPage;
      const correction = correctEmptyPage(requestedPage, result, PAGE_SIZE);
      if (correction) {
        resultPage = correction.page;
        if (correction.refetch) {
          result = await careersApi.opportunityQueuePage(undefined, resultPage, PAGE_SIZE);
          if (!opportunitySequence.current.isCurrent(requestId)) return;
        }
      }
      if (result.items.length === 0 && result.total !== undefined && result.total > 0) {
        setError(copy.failed);
        return;
      }

      setOpportunities(result.items);
      setOpportunityTotal(result.total ?? null);
      setOpportunityPage(resultPage);
      currentOpportunitySelection.current = resultPage;
    } catch (cause) {
      if (!opportunitySequence.current.isCurrent(requestId)) return;
      const kind = campusErrorKind(cause);
      if (errorCode(cause) === 'CAREERS_STAFF_REQUIRED'
        || kind === 'forbidden' || kind === 'unauthorized') {
        setDenied(true);
      } else {
        setError(copy.failed);
      }
    }
  }, [copy]);

  const loadApplications = useCallback(async (requestedPage: number) => {
    const requestId = applicationSequence.current.begin();
    currentApplicationSelection.current = requestedPage;
    setError('');
    try {
      let result = await careersApi.applicationQueuePage(undefined, undefined, requestedPage, PAGE_SIZE);
      if (!applicationSequence.current.isCurrent(requestId)) return;

      let resultPage = requestedPage;
      const correction = correctEmptyPage(requestedPage, result, PAGE_SIZE);
      if (correction) {
        resultPage = correction.page;
        if (correction.refetch) {
          result = await careersApi.applicationQueuePage(
            undefined, undefined, resultPage, PAGE_SIZE);
          if (!applicationSequence.current.isCurrent(requestId)) return;
        }
      }
      if (result.items.length === 0 && result.total !== undefined && result.total > 0) {
        setError(copy.failed);
        return;
      }

      setApplications(result.items);
      setApplicationTotal(result.total ?? null);
      setApplicationPage(resultPage);
      currentApplicationSelection.current = resultPage;
    } catch (cause) {
      if (!applicationSequence.current.isCurrent(requestId)) return;
      const kind = campusErrorKind(cause);
      if (errorCode(cause) === 'CAREERS_STAFF_REQUIRED'
        || kind === 'forbidden' || kind === 'unauthorized') {
        setDenied(true);
      } else {
        setError(copy.failed);
      }
    }
  }, [copy]);

  const loadReviewQueue = useCallback(async (requestedPage: number) => {
    const requestId = reviewSequence.current.begin();
    currentReviewSelection.current = requestedPage;
    setError('');
    try {
      let result = await careersApi.reviewQueuePage(requestedPage, PAGE_SIZE);
      if (!reviewSequence.current.isCurrent(requestId)) return;

      let resultPage = requestedPage;
      const correction = correctEmptyPage(requestedPage, result, PAGE_SIZE);
      if (correction) {
        resultPage = correction.page;
        if (correction.refetch) {
          result = await careersApi.reviewQueuePage(resultPage, PAGE_SIZE);
          if (!reviewSequence.current.isCurrent(requestId)) return;
        }
      }
      if (result.items.length === 0 && result.total !== undefined && result.total > 0) {
        setError(copy.failed);
        return;
      }

      setReviewQueue(result.items);
      setReviewTotal(result.total ?? null);
      setReviewPage(resultPage);
      currentReviewSelection.current = resultPage;
    } catch (cause) {
      if (!reviewSequence.current.isCurrent(requestId)) return;
      const code = errorCode(cause);
      const kind = campusErrorKind(cause);
      if (code === 'CAREERS_REVIEWER_REQUIRED' || code === 'CAREERS_STAFF_REQUIRED') {
        setIsReviewer(false);
        setReviewQueue([]);
        setReviewTotal(null);
      } else if (kind === 'forbidden' || kind === 'unauthorized') {
        setDenied(true);
      } else {
        setError(copy.failed);
      }
    }
  }, [copy]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    setDenied(false);
    let recruiter = false;
    let reviewer = false;
    try {
      const orgs = await careersApi.myOrganizations().catch((cause) => {
        if (errorCode(cause) === 'CAREERS_STAFF_REQUIRED') return [];
        throw cause;
      });
      setOrganizations(orgs);
      if (orgs.length > 0) {
        recruiter = true;
        setOrganizationId((current) => current || orgs[0].id);
        await Promise.all([loadOpportunities(0), loadApplications(0)]);
      }
      const review = await careersApi.reviewQueuePage(0, PAGE_SIZE).catch((cause) => {
        if (errorCode(cause) === 'CAREERS_REVIEWER_REQUIRED'
            || errorCode(cause) === 'CAREERS_STAFF_REQUIRED') return null;
        throw cause;
      });
      if (review !== null) {
        reviewer = true;
        setReviewQueue(review.items);
        setReviewTotal(review.total ?? null);
        setReviewPage(0);
        currentReviewSelection.current = 0;
      }
    } catch (cause) {
      const code = errorCode(cause);
      const kind = campusErrorKind(cause);
      if (code === 'CAREERS_STAFF_REQUIRED' || code === 'CAREERS_REVIEWER_REQUIRED'
        || kind === 'forbidden' || kind === 'unauthorized') {
        setDenied(true);
      } else {
        setError(copy.failed);
      }
    } finally {
      setIsRecruiter(recruiter);
      setIsReviewer(reviewer);
      setIsLoading(false);
    }
  }, [copy, loadApplications, loadOpportunities]);

  useEffect(() => {
    void load();
  }, [load]);

  const reloadCurrentOpportunities = useCallback(
    () => loadOpportunities(currentOpportunitySelection.current),
    [loadOpportunities],
  );
  const reloadCurrentApplications = useCallback(
    () => loadApplications(currentApplicationSelection.current),
    [loadApplications],
  );
  const reloadCurrentReview = useCallback(
    () => loadReviewQueue(currentReviewSelection.current),
    [loadReviewQueue],
  );
  const reloadReviewAndOpportunities = useCallback(async () => {
    await Promise.all([reloadCurrentReview(), reloadCurrentOpportunities()]);
  }, [reloadCurrentOpportunities, reloadCurrentReview]);

  const reason = (id: string) => reasons[id] ?? '';
  const setReason = (id: string, value: string) =>
    setReasons((current) => ({ ...current, [id]: value }));

  const run = async (action: () => Promise<unknown>, okMessage: string,
      refresh: () => Promise<void>) => {
    setIsBusy(true);
    try {
      await action();
      toast.success(okMessage);
      await refresh();
    } catch (cause) {
      setError(friendlyMessage(copy, errorCode(cause)));
    } finally {
      setIsBusy(false);
    }
  };

  const friendlyMessage = (messages: Copy, code: string) => {
    if (code === 'MODERATION_REASON_REQUIRED') return messages.rejectionReasonRequired;
    if (code === 'CAREERS_STAFF_REQUIRED') return messages.staffRequired;
    if (code === 'CAREERS_REVIEWER_REQUIRED') return messages.reviewerRequired;
    return messages.failed;
  };

  const summaryFor = (currentPage: number, totalCount: number | null, itemCount: number) => {
    const firstVisible = itemCount === 0 ? 0 : currentPage * PAGE_SIZE + 1;
    const lastVisible = currentPage * PAGE_SIZE + itemCount;
    return totalCount === null
      ? `${messages.common.states.showingResults} ${firstVisible} ${messages.common.states.to} ${lastVisible} ${messages.common.states.results}`
      : `${messages.common.states.showingResults} ${firstVisible} ${messages.common.states.to} ${lastVisible} ${messages.common.states.of} ${totalCount} ${messages.common.states.results}`;
  };

  if (authLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-8" data-testid="careers-desk-page">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.deskEyebrow}</SectionEyebrow>}
        title={copy.deskTitle}
        description={copy.deskDescription}
        actions={<Button variant="outline" onClick={() => void load()}>{copy.refresh}</Button>}
      />

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
        data-testid="careers-desk-simulated-banner">
        {copy.simulatedBanner}
      </p>

      {denied || (!isLoading && !error && !isRecruiter && !isReviewer) ? (
        <ForbiddenState
          title={copy.staffRequired}
          description={copy.reviewerRequired}
          action={(
            <LinkButton href="/dashboard" variant="outline">
              {messages.common.actions.openDashboard}
            </LinkButton>
          )}
        />
      ) : null}
      {error ? (
        <ErrorState title={copy.failed} description={error} onRetry={() => void load()} />
      ) : null}
      {isLoading ? <LoadingState /> : null}

      {!isLoading && isRecruiter ? (
        <>
          <section className="space-y-3" data-testid="careers-my-orgs">
            <h2 className="text-lg font-semibold">{copy.myOrgs}</h2>
            <p className="text-sm text-muted-foreground">
              {organizations.map((organization) => organization.name).join(', ')}
            </p>
          </section>

          <section className="space-y-3" data-testid="careers-new-opportunity">
            <h2 className="text-lg font-semibold">{copy.newOpportunity}</h2>
            <div className="flex flex-wrap items-end gap-2">
              <select
                className="rounded-md border bg-background px-3 py-2 text-sm"
                data-testid="careers-org-select"
                aria-label={copy.organization}
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
              <div className="flex w-full max-w-md flex-col gap-1">
                <label htmlFor="careers-opportunity-title" className="text-xs font-medium text-muted-foreground">
                  {copy.titleLabel}
                </label>
                <Input
                  id="careers-opportunity-title"
                  data-testid="careers-opp-title-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={copy.titlePlaceholder}
                />
              </div>
              <Button variant="outline" disabled={isBusy || !title.trim()}
                data-testid="careers-create-opp"
                onClick={() => void run(async () => {
                  await careersApi.createOpportunity({ organizationId, title });
                  setTitle('');
                }, copy.draftCreated, reloadCurrentOpportunities)}>
                {copy.createDraft}
              </Button>
            </div>
          </section>

          <section className="space-y-3" data-testid="careers-opp-queue">
            <h2 className="text-lg font-semibold">{copy.opportunityQueue}</h2>
            {opportunities.length === 0 ? (
              <EmptyState title={copy.queueEmpty} description="" />
            ) : null}
            {opportunities.map((opportunity) => (
              <article key={opportunity.id} className="rounded-lg border p-4"
                data-testid={`careers-staff-opp-${opportunity.id}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-medium">{opportunity.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {opportunity.organizationName}
                      {opportunity.moderationReason
                        ? ` • ${copy.moderationReason}: ${opportunity.moderationReason}`
                        : ''}
                    </p>
                  </div>
                  <span className={cn('rounded px-2 py-0.5 text-xs',
                    statusToneClass(OPPORTUNITY_TONE[opportunity.status] ?? 'neutral'))}
                    data-testid={`careers-staff-opp-status-${opportunity.id}`}>
                    {copy.opportunityStatusLabels[opportunity.status] ?? opportunity.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {opportunity.status === 'DRAFT' ? (
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`careers-submit-review-${opportunity.id}`}
                      onClick={() => void run(
                        () => careersApi.submitReview(opportunity.id, opportunity.version),
                        copy.submittedForReview, reloadCurrentOpportunities)}>
                      {copy.submitReview}
                    </Button>
                  ) : null}
                  {opportunity.status === 'PUBLISHED' || opportunity.status === 'PAUSED' ? (
                    <Input
                      className="max-w-xs"
                      data-testid={`careers-opp-reason-${opportunity.id}`}
                      value={reason(opportunity.id)}
                      onChange={(event) => setReason(opportunity.id, event.target.value)}
                      placeholder={copy.reasonPlaceholder}
                      aria-label={`${copy.reasonPlaceholder}: ${opportunity.title}`}
                    />
                  ) : null}
                  {opportunity.status === 'PUBLISHED' ? (
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`careers-pause-${opportunity.id}`}
                      onClick={() => void run(
                        () => careersApi.pauseOpportunity(opportunity.id,
                          opportunity.version, reason(opportunity.id)),
                        copy.pausedOk, reloadCurrentOpportunities)}>
                      {copy.pause}
                    </Button>
                  ) : null}
                  {opportunity.status === 'PAUSED' ? (
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`careers-resume-${opportunity.id}`}
                      onClick={() => void run(
                        () => careersApi.resumeOpportunity(opportunity.id, opportunity.version),
                        copy.resumedOk, reloadCurrentOpportunities)}>
                      {copy.resume}
                    </Button>
                  ) : null}
                  {opportunity.status === 'PUBLISHED' || opportunity.status === 'PAUSED' ? (
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`careers-close-${opportunity.id}`}
                      onClick={() => void run(
                        () => careersApi.closeOpportunity(opportunity.id,
                          opportunity.version, reason(opportunity.id)),
                        copy.closedOk, reloadCurrentOpportunities)}>
                      {copy.close}
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
            <DeskPager
              testId="careers-opportunity-pagination"
              page={opportunityPage}
              total={opportunityTotal}
              itemCount={opportunities.length}
              summary={summaryFor(opportunityPage, opportunityTotal, opportunities.length)}
              previousLabel={messages.common.states.goToPreviousPage}
              nextLabel={messages.common.states.goToNextPage}
              navLabel={messages.common.states.page}
              onPage={(nextPage) => void loadOpportunities(nextPage)}
            />
          </section>

          <section className="space-y-3" data-testid="careers-staff-applications">
            <h2 className="text-lg font-semibold">{copy.applications}</h2>
            {applications.length === 0 ? (
              <EmptyState title={copy.applicationsEmpty} description="" />
            ) : null}
            {applications.map((application) => (
              <article key={application.id} className="rounded-lg border p-4"
                data-testid={`careers-staff-app-${application.id}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-medium">
                      {application.candidateEmail ?? application.candidateUserId}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {application.opportunityTitle}
                      {application.submittedAt
                        ? ` • ${copy.submittedAt}: ${formatDateTime(application.submittedAt)}`
                        : ''}
                      {application.attachments.length > 0
                        ? ` • ${copy.attachments}: ${application.attachments
                          .map((attachment) => attachment.fileName).join(', ')}`
                        : ''}
                    </p>
                    {application.coverLetter ? (
                      <p className="mt-1 text-sm italic text-muted-foreground">
                        {application.coverLetter}
                      </p>
                    ) : null}
                  </div>
                  <span className={cn('rounded px-2 py-0.5 text-xs',
                    statusToneClass(APPLICATION_TONE[application.status] ?? 'neutral'))}
                    data-testid={`careers-staff-app-status-${application.id}`}>
                    {copy.applicationStatusLabels[application.status] ?? application.status}
                  </span>
                </div>
                {NEXT_STEP[application.status] || !['REJECTED', 'WITHDRAWN'].includes(application.status) ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {NEXT_STEP[application.status] ? (
                      <Button size="sm" variant="outline" disabled={isBusy}
                        data-testid={`careers-advance-${application.id}`}
                        onClick={() => void run(
                          () => careersApi.transitionApplication(application.id,
                            NEXT_STEP[application.status].step, application.version),
                          copy.transitioned, reloadCurrentApplications)}>
                        {copy[NEXT_STEP[application.status].label] as string}
                      </Button>
                    ) : null}
                    {!['REJECTED', 'WITHDRAWN'].includes(application.status) ? (
                      <>
                        <Input
                          className="max-w-xs"
                          data-testid={`careers-app-reason-${application.id}`}
                          value={reason(application.id)}
                          onChange={(event) => setReason(application.id, event.target.value)}
                          placeholder={copy.reasonPlaceholder}
                          aria-label={`${copy.reasonPlaceholder}: ${application.candidateEmail || application.id}`}
                        />
                        <Button size="sm" variant="outline" disabled={isBusy}
                          data-testid={`careers-app-reject-${application.id}`}
                          onClick={() => void run(
                            () => careersApi.rejectApplication(application.id,
                              application.version, reason(application.id)),
                            copy.rejectedOk, reloadCurrentApplications)}>
                          {copy.rejectApplication}
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
            <DeskPager
              testId="careers-application-pagination"
              page={applicationPage}
              total={applicationTotal}
              itemCount={applications.length}
              summary={summaryFor(applicationPage, applicationTotal, applications.length)}
              previousLabel={messages.common.states.goToPreviousPage}
              nextLabel={messages.common.states.goToNextPage}
              navLabel={messages.common.states.page}
              onPage={(nextPage) => void loadApplications(nextPage)}
            />
          </section>
        </>
      ) : null}

      {!isLoading && isReviewer ? (
        <section className="space-y-3" data-testid="careers-review-queue">
          <h2 className="text-lg font-semibold">{copy.reviewQueue}</h2>
          {reviewQueue.length === 0 ? (
            <EmptyState title={copy.reviewQueueEmpty} description="" />
          ) : null}
          {reviewQueue.map((opportunity) => (
            <article key={opportunity.id} className="rounded-lg border p-4"
              data-testid={`careers-review-${opportunity.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-medium">{opportunity.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {opportunity.organizationName}
                  </p>
                </div>
                <span className={cn('rounded px-2 py-0.5 text-xs',
                  statusToneClass(OPPORTUNITY_TONE[opportunity.status] ?? 'neutral'))}>
                  {copy.opportunityStatusLabels[opportunity.status] ?? opportunity.status}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={isBusy}
                  data-testid={`careers-publish-${opportunity.id}`}
                  onClick={() => void run(
                    () => careersApi.publish(opportunity.id, opportunity.version),
                    copy.published, reloadReviewAndOpportunities)}>
                  {copy.publish}
                </Button>
                <Input
                  className="max-w-xs"
                  data-testid={`careers-review-reason-${opportunity.id}`}
                  value={reason(`review-${opportunity.id}`)}
                  onChange={(event) => setReason(`review-${opportunity.id}`, event.target.value)}
                  placeholder={copy.reasonPlaceholder}
                  aria-label={`${copy.reasonPlaceholder}: ${opportunity.title}`}
                />
                <Button size="sm" variant="outline" disabled={isBusy}
                  data-testid={`careers-reject-opp-${opportunity.id}`}
                  onClick={() => void run(
                    () => careersApi.rejectOpportunity(opportunity.id,
                      opportunity.version, reason(`review-${opportunity.id}`)),
                    copy.rejectedOpportunity, reloadReviewAndOpportunities)}>
                  {copy.reject}
                </Button>
              </div>
            </article>
          ))}
          <DeskPager
            testId="careers-review-pagination"
            page={reviewPage}
            total={reviewTotal}
            itemCount={reviewQueue.length}
            summary={summaryFor(reviewPage, reviewTotal, reviewQueue.length)}
            previousLabel={messages.common.states.goToPreviousPage}
            nextLabel={messages.common.states.goToNextPage}
            navLabel={messages.common.states.page}
            onPage={(nextPage) => void loadReviewQueue(nextPage)}
          />
        </section>
      ) : null}
    </div>
  );
}
