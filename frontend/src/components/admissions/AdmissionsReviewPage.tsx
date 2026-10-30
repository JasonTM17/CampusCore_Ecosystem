'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRequireAuth } from '@/context/AuthContext';
import {
  admissionsApi,
  type AdmissionApplication,
  type ApplicationStatus,
  type ChecklistItem,
} from '@/lib/admissions-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/components/ui/state-block';
import { LinkButton } from '@/components/ui/link-button';
import { campusErrorKind } from '@/lib/campus-error';
import { statusToneClass, type StatusTone } from '@/components/ui/status';
import { admissionsMessages } from '@/i18n/admissions-messages';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

type Copy = (typeof admissionsMessages)['vi'];

const STATUS_TONE: Record<ApplicationStatus, StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  IN_REVIEW: 'warning',
  RETURNED: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};

const FILTERS: Array<ApplicationStatus | ''> = [
  '', 'SUBMITTED', 'IN_REVIEW', 'RETURNED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'DRAFT',
];

function errorCode(error: unknown): string {
  return String((error as { response?: { data?: { code?: string } } })?.response?.data?.code ?? '');
}

function friendlyError(copy: Copy, error: unknown): string {
  const code = errorCode(error);
  if (code === 'ADMISSIONS_STAFF_REQUIRED') return copy.staffRequired;
  if (code === 'APPLICATION_REVIEW_NOT_OWNED') return copy.reviewNotOwned;
  if (code === 'STALE_VERSION') return copy.staleVersion;
  return copy.failed;
}

/**
 * Staff admissions review surface (contract §7, phase-10). The queue is
 * scope-wide for grantees; claim binds the review lanes to the claiming
 * reviewer. Decisions carry the SIMULATED label end-to-end.
 */
export function AdmissionsReviewPage() {
  const { isLoading: authLoading } = useRequireAuth();
  const { locale, formatDateTime, messages } = useI18n();
  const copy = admissionsMessages[locale];
  const [queue, setQueue] = useState<AdmissionApplication[]>([]);
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | ''>('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<AdmissionApplication | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  const loadQueue = useCallback(async () => {
    setIsLoading(true);
    setError('');
    setForbidden(false);
    try {
      const rows = await admissionsApi.queue(statusFilter || undefined);
      setQueue(rows);
    } catch (cause) {
      const kind = campusErrorKind(cause);
      if (errorCode(cause) === 'ADMISSIONS_STAFF_REQUIRED'
        || kind === 'forbidden' || kind === 'unauthorized') {
        setForbidden(true);
      } else {
        setError(friendlyError(copy, cause));
      }
    } finally {
      setIsLoading(false);
    }
  }, [copy, statusFilter]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      const row = await admissionsApi.staffApplication(id);
      setDetail(row);
      setChecklist([]);
      setReturnNote('');
      setDecisionNote('');
    } catch (cause) {
      setError(friendlyError(copy, cause));
    }
  }, [copy]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const act = async (action: () => Promise<unknown>, okMessage: string) => {
    if (!detail) {
      return;
    }
    setIsActing(true);
    setError('');
    try {
      await action();
      toast.success(okMessage);
      await Promise.all([loadQueue(), loadDetail(detail.id)]);
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsActing(false);
    }
  };

  const claim = () => act(() => admissionsApi.claim(detail!.id, detail!.version), copy.claimedOk);
  const returnApplication = () => act(
    () => admissionsApi.returnApplication(detail!.id, checklist, returnNote, detail!.version),
    copy.returnedOk);
  const decide = (decision: 'ACCEPTED' | 'REJECTED') => act(
    () => admissionsApi.decide(detail!.id, decision, decisionNote, detail!.version),
    copy.decidedOk);

  if (authLoading) {
    return <LoadingState />;
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8" data-testid="admissions-review-page">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.staffEyebrow}</SectionEyebrow>}
        title={copy.staffTitle}
        description={copy.staffDescription}
        actions={(
          <Button variant="outline" onClick={() => void loadQueue()} disabled={isLoading}>
            {copy.refresh}
          </Button>
        )}
      />

      <div className="mt-4 rounded-xl border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-status-warning-foreground" data-testid="admissions-simulated-banner">
        {copy.simulatedBanner}
      </div>

      {forbidden ? (
        <div className="mt-8" data-testid="admissions-forbidden">
          <ForbiddenState
            title={copy.staffRequired}
            description=""
            action={(
              <LinkButton href="/dashboard" variant="outline">
                {messages.common.actions.openDashboard}
              </LinkButton>
            )}
          />
        </div>
      ) : null}
      {error ? <div className="mt-4"><ErrorState title={copy.failed} description={error} onRetry={() => void loadQueue()} /></div> : null}
      {isLoading && !forbidden ? <div className="mt-8"><LoadingState label={copy.loading} /></div> : null}

      {!isLoading && !forbidden && !error && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[380px_1fr]">
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map((filter) => (
                <Button
                  key={filter || 'all'}
                  size="sm"
                  variant={statusFilter === filter ? 'default' : 'outline'}
                  data-testid={`admissions-filter-${filter || 'all'}`}
                  onClick={() => setStatusFilter(filter)}
                >
                  {filter === '' ? copy.filterAll : copy.statusLabels[filter]}
                </Button>
              ))}
            </div>
            <h2 className="text-lg font-semibold">{copy.queue}</h2>
            {queue.length === 0 ? (
              <EmptyState title={copy.queueEmpty} description="" />
            ) : (
              <ul className="space-y-3" data-testid="admissions-queue">
                {queue.map((application) => (
                  <li key={application.id}>
                    <button
                      type="button"
                      data-testid={`admissions-queue-row-${application.id}`}
                      onClick={() => setSelectedId(application.id)}
                      className={cn(
                        'w-full rounded-xl border px-4 py-3 text-left transition',
                        application.id === selectedId
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-card hover:border-primary/60',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{application.fullName || application.applicantEmail}</p>
                          <p className="text-xs text-muted-foreground">
                            {application.applicantEmail} • {application.cycle}
                          </p>
                        </div>
                        <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', statusToneClass(STATUS_TONE[application.status]))}>
                          {copy.statusLabels[application.status]}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            {detail && (
              <div className="rounded-xl border border-border bg-card p-5" data-testid="admissions-review-detail">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{detail.fullName || detail.applicantEmail}</h2>
                    <p className="text-xs text-muted-foreground">
                      {detail.applicantEmail} • {detail.cycle} • v{detail.version}
                    </p>
                  </div>
                  <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', statusToneClass(STATUS_TONE[detail.status]))} data-testid="admissions-review-status">
                    {copy.statusLabels[detail.status]}
                  </span>
                </div>

                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">{copy.dateOfBirth}</dt><dd>{detail.dateOfBirth || '—'}</dd></div>
                  <div><dt className="text-muted-foreground">{copy.schoolName}</dt><dd>{detail.schoolName || '—'}</dd></div>
                  <div><dt className="text-muted-foreground">{copy.intendedMajor}</dt><dd>{detail.intendedMajor || '—'}</dd></div>
                  <div><dt className="text-muted-foreground">{copy.submittedAt}</dt><dd>{detail.submittedAt ? formatDateTime(detail.submittedAt) : '—'}</dd></div>
                </dl>
                {detail.essay && (
                  <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">{detail.essay}</p>
                )}
                {detail.decision && (
                  <p className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-medium" data-testid="admissions-decision-label">
                    {copy.decision}: {copy.statusLabels[detail.decision]} — {detail.decisionLabel}
                  </p>
                )}

                <div className="mt-4">
                  <h3 className="font-semibold">{copy.attachments}</h3>
                  {detail.attachments.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">{copy.attachmentsEmpty}</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {detail.attachments.map((attachment) => (
                        <li key={attachment.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                          <span className="truncate">{attachment.fileName}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void admissionsApi.staffDownloadAttachment(detail.id, attachment.id, attachment.fileName)}
                          >
                            {copy.download}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {detail.status === 'SUBMITTED' && (
                  <div className="mt-5">
                    <Button data-testid="admissions-claim" onClick={claim} disabled={isActing}>
                      {copy.claim}
                    </Button>
                  </div>
                )}

                {detail.status === 'IN_REVIEW' && (
                  <div className="mt-5 space-y-4">
                    <div>
                      <h3 className="font-semibold">{copy.checklist}</h3>
                      <div className="mt-2 space-y-2" data-testid="admissions-checklist">
                        {checklist.map((item, index) => (
                          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_120px_1fr]">
                            <Input
                              value={item.item}
                              placeholder={copy.checklistItem}
                              onChange={(event) => setChecklist((current) => current.map(
                                (entry, i) => (i === index ? { ...entry, item: event.target.value } : entry)))}
                            />
                            <select
                              className="rounded-md border border-border bg-background px-2 text-sm"
                              aria-label={copy.checklistResult}
                              value={item.result ?? 'NOTE'}
                              onChange={(event) => setChecklist((current) => current.map(
                                (entry, i) => (i === index
                                  ? { ...entry, result: event.target.value as ChecklistItem['result'] }
                                  : entry)))}
                            >
                              <option value="PASS">PASS</option>
                              <option value="FAIL">FAIL</option>
                              <option value="NOTE">NOTE</option>
                            </select>
                            <Input
                              value={item.note ?? ''}
                              placeholder={copy.checklistNote}
                              onChange={(event) => setChecklist((current) => current.map(
                                (entry, i) => (i === index ? { ...entry, note: event.target.value } : entry)))}
                            />
                          </div>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        data-testid="admissions-checklist-add"
                        onClick={() => setChecklist((current) => [...current, { item: '', result: 'NOTE' }])}
                      >
                        {copy.addChecklistItem}
                      </Button>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">{copy.returnNote}</label>
                      <Textarea
                        data-testid="admissions-return-note"
                        value={returnNote}
                        onChange={(event) => setReturnNote(event.target.value)}
                        rows={2}
                      />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">{copy.decisionNote}</label>
                      <Textarea
                        data-testid="admissions-decision-note"
                        value={decisionNote}
                        onChange={(event) => setDecisionNote(event.target.value)}
                        rows={2}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        data-testid="admissions-return"
                        onClick={returnApplication}
                        disabled={isActing}
                      >
                        {copy.returnToApplicant}
                      </Button>
                      <Button
                        data-testid="admissions-accept"
                        onClick={() => decide('ACCEPTED')}
                        disabled={isActing}
                      >
                        {copy.accept}
                      </Button>
                      <Button
                        variant="destructive"
                        data-testid="admissions-reject"
                        onClick={() => decide('REJECTED')}
                        disabled={isActing}
                      >
                        {copy.reject}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-6">
                  <h3 className="font-semibold">{copy.reviews}</h3>
                  {detail.reviews.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">{copy.reviewsEmpty}</p>
                  ) : (
                    <ol className="mt-2 space-y-2" data-testid="admissions-reviews">
                      {detail.reviews.map((review) => (
                        <li key={review.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{copy.reviewActions[review.action]}</span>
                            <span className="text-xs text-muted-foreground">
                              {review.createdAt ? formatDateTime(review.createdAt) : ''}
                            </span>
                          </div>
                          {review.note && <p className="mt-1 text-muted-foreground">{review.note}</p>}
                          {review.checklist && <p className="mt-1 text-xs text-muted-foreground">{review.checklist}</p>}
                          {review.decision && <p className="mt-1 font-medium">{copy.statusLabels[review.decision]}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
