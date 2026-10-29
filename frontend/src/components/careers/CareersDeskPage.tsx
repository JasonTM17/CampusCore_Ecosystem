'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { statusToneClass, type StatusTone } from '@/components/ui/status';
import { careerMessages } from '@/i18n/careers-messages';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

type Copy = (typeof careerMessages)['vi'];

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
 * Staff careers surface (contract §9, phase-12): the org-recruiter lane
 * (create/submit-review/pause/resume/close postings, review applications
 * inside granted organizations only) plus the platform reviewer lane
 * (IN_REVIEW → PUBLISHED/REJECTED, never on the reviewer's own
 * submission). Every scope check is enforced server-side; this page only
 * renders what the API returns.
 */
export function CareersDeskPage() {
  const { isLoading: authLoading } = useRequireAuth();
  const { locale, formatDateTime } = useI18n();
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

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
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
        const [rows, apps] = await Promise.all([
          careersApi.opportunityQueue(),
          careersApi.applicationQueue(),
        ]);
        setOpportunities(rows);
        setApplications(apps);
      }
      const review = await careersApi.reviewQueue().catch((cause) => {
        if (errorCode(cause) === 'CAREERS_REVIEWER_REQUIRED'
            || errorCode(cause) === 'CAREERS_STAFF_REQUIRED') return null;
        throw cause;
      });
      if (review !== null) {
        reviewer = true;
        setReviewQueue(review);
      }
    } catch (cause) {
      const code = errorCode(cause);
      if (code === 'CAREERS_STAFF_REQUIRED' || code === 'CAREERS_REVIEWER_REQUIRED') {
        setError(copy.staffRequired);
      } else {
        setError(copy.failed);
      }
    } finally {
      setIsRecruiter(recruiter);
      setIsReviewer(reviewer);
      setIsLoading(false);
    }
  }, [copy]);

  useEffect(() => {
    void load();
  }, [load]);

  const reason = (id: string) => reasons[id] ?? '';
  const setReason = (id: string, value: string) =>
    setReasons((current) => ({ ...current, [id]: value }));

  const run = async (action: () => Promise<unknown>, okMessage: string) => {
    setIsBusy(true);
    try {
      await action();
      toast.success(okMessage);
      await load();
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

      {error ? <ErrorState title={copy.failed} description={error} /> : null}
      {isLoading ? <LoadingState /> : null}

      {!isLoading && !error && !isRecruiter && !isReviewer ? (
        <ErrorState title={copy.staffRequired} description={copy.reviewerRequired} />
      ) : null}

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
            <div className="flex flex-wrap gap-2">
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
              <Input
                className="max-w-md"
                data-testid="careers-opp-title-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={copy.titlePlaceholder}
              />
              <Button variant="outline" disabled={isBusy || !title.trim()}
                data-testid="careers-create-opp"
                onClick={() => void run(async () => {
                  await careersApi.createOpportunity({ organizationId, title });
                  setTitle('');
                }, copy.draftCreated)}>
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
                        copy.submittedForReview)}>
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
                    />
                  ) : null}
                  {opportunity.status === 'PUBLISHED' ? (
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`careers-pause-${opportunity.id}`}
                      onClick={() => void run(
                        () => careersApi.pauseOpportunity(opportunity.id,
                          opportunity.version, reason(opportunity.id)),
                        copy.pausedOk)}>
                      {copy.pause}
                    </Button>
                  ) : null}
                  {opportunity.status === 'PAUSED' ? (
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`careers-resume-${opportunity.id}`}
                      onClick={() => void run(
                        () => careersApi.resumeOpportunity(opportunity.id, opportunity.version),
                        copy.resumedOk)}>
                      {copy.resume}
                    </Button>
                  ) : null}
                  {opportunity.status === 'PUBLISHED' || opportunity.status === 'PAUSED' ? (
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`careers-close-${opportunity.id}`}
                      onClick={() => void run(
                        () => careersApi.closeOpportunity(opportunity.id,
                          opportunity.version, reason(opportunity.id)),
                        copy.closedOk)}>
                      {copy.close}
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
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
                          copy.transitioned)}>
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
                        />
                        <Button size="sm" variant="outline" disabled={isBusy}
                          data-testid={`careers-app-reject-${application.id}`}
                          onClick={() => void run(
                            () => careersApi.rejectApplication(application.id,
                              application.version, reason(application.id)),
                            copy.rejectedOk)}>
                          {copy.rejectApplication}
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
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
                    copy.published)}>
                  {copy.publish}
                </Button>
                <Input
                  className="max-w-xs"
                  data-testid={`careers-review-reason-${opportunity.id}`}
                  value={reason(`review-${opportunity.id}`)}
                  onChange={(event) => setReason(`review-${opportunity.id}`, event.target.value)}
                  placeholder={copy.reasonPlaceholder}
                />
                <Button size="sm" variant="outline" disabled={isBusy}
                  data-testid={`careers-reject-opp-${opportunity.id}`}
                  onClick={() => void run(
                    () => careersApi.rejectOpportunity(opportunity.id,
                      opportunity.version, reason(`review-${opportunity.id}`)),
                    copy.rejectedOpportunity)}>
                  {copy.reject}
                </Button>
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
