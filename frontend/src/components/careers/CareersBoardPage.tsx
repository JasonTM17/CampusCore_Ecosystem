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

function isWithdrawable(application: CareerApplication): boolean {
  return ['SUBMITTED', 'REVIEWING', 'INTERVIEW', 'OFFER'].includes(application.status);
}

function friendlyError(copy: Copy, error: unknown): string {
  const code = String(
    (error as { response?: { data?: { code?: string } } })?.response?.data?.code ?? '');
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
  const { locale, formatDateTime } = useI18n();
  const copy = careerMessages[locale];
  const [opportunities, setOpportunities] = useState<CareerOpportunity[]>([]);
  const [applications, setApplications] = useState<CareerApplication[]>([]);
  const [query, setQuery] = useState('');
  const [coverLetters, setCoverLetters] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async (search?: string) => {
    setIsLoading(true);
    setError('');
    try {
      const [rows, mine] = await Promise.all([
        careersApi.opportunities(search),
        careersApi.myApplications(),
      ]);
      setOpportunities(rows);
      setApplications(mine);
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsLoading(false);
    }
  }, [copy]);

  useEffect(() => {
    void load();
  }, [load]);

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
      await load(query || undefined);
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
      await load(query || undefined);
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsBusy(false);
    }
  };

  const upload = async (application: CareerApplication, file: File | undefined) => {
    if (!file) return;
    setIsBusy(true);
    try {
      await careersApi.uploadAttachment(application.id, file, newCareerIdempotencyKey());
      toast.success(copy.uploaded);
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
    <div className="space-y-8" data-testid="careers-board-page">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
        title={copy.title}
        description={copy.description}
        actions={<Button variant="outline" onClick={() => void load(query || undefined)}>{copy.refresh}</Button>}
      />

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
        data-testid="careers-simulated-banner">
        {copy.simulatedBanner}
      </p>

      {error ? <ErrorState title={copy.failed} description={error} /> : null}

      <div className="flex gap-2">
        <Input
          data-testid="careers-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchPlaceholder}
          onKeyDown={(event) => { if (event.key === 'Enter') void load(query || undefined); }}
        />
        <Button data-testid="careers-search" variant="outline" onClick={() => void load(query || undefined)}>
          {copy.search}
        </Button>
      </div>

      {isLoading ? <LoadingState /> : null}

      {!isLoading && opportunities.length === 0 ? (
        <EmptyState title={copy.emptyBoard} description="" />
      ) : null}

      {!isLoading && opportunities.length > 0 ? (
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
                    <input type="file" hidden
                      ref={(element) => { fileInputs.current[application.id] = element; }}
                      onChange={(event) => {
                        void upload(application, event.target.files?.[0]);
                        event.target.value = '';
                      }} />
                    <Button size="sm" variant="outline" disabled={isBusy}
                      data-testid={`careers-upload-${application.id}`}
                      onClick={() => fileInputs.current[application.id]?.click()}>
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
