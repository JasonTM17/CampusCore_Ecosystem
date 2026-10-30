'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRequireAuth } from '@/context/AuthContext';
import {
  admissionsApi,
  newAdmissionsIdempotencyKey,
  type AdmissionApplication,
  type ApplicationForm,
} from '@/lib/admissions-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { campusErrorKind } from '@/lib/campus-error';
import { assertUploadFile, UPLOAD_ACCEPT_DOCUMENTS } from '@/lib/upload-validation';
import { statusToneClass, type StatusTone } from '@/components/ui/status';
import { admissionsMessages } from '@/i18n/admissions-messages';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

type Copy = (typeof admissionsMessages)['vi'];

const EMPTY_FORM: ApplicationForm = {
  fullName: '',
  dateOfBirth: '',
  schoolName: '',
  intendedMajor: '',
  essay: '',
};

function errorCode(error: unknown): string {
  return String(
    (error as { response?: { data?: { code?: string } } })?.response?.data?.code
    ?? (error as { code?: string })?.code
    ?? '');
}

function friendlyError(copy: Copy, error: unknown): string {
  const code = errorCode(error);
  if (code === 'UPLOAD_TOO_LARGE') return copy.uploadTooLarge;
  if (code === 'UPLOAD_TYPE_UNSUPPORTED') return copy.uploadTypeUnsupported;
  if (code === 'APPLICATION_CYCLE_ACTIVE') return copy.cycleActive;
  if (code === 'APPLICATION_INCOMPLETE') return copy.incomplete;
  if (code === 'STALE_VERSION') return copy.staleVersion;
  return copy.failed;
}

const STATUS_TONE: Record<AdmissionApplication['status'], StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  IN_REVIEW: 'warning',
  RETURNED: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};

function isEditable(application: AdmissionApplication): boolean {
  return application.status === 'DRAFT' || application.status === 'RETURNED';
}

function isTerminal(application: AdmissionApplication): boolean {
  return application.status === 'ACCEPTED'
    || application.status === 'REJECTED'
    || application.status === 'WITHDRAWN';
}

async function pickFileBase64(input: HTMLInputElement | null): Promise<{ fileName: string; contentType: string; dataBase64: string } | null> {
  const file = input?.files?.[0];
  if (!file) {
    return null;
  }
  // Refuses before the bytes are ever read into the tab (UploadValidationError).
  assertUploadFile(file, 'documents');
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    dataBase64: btoa(binary),
  };
}

/**
 * Applicant admissions surface (contract §7, phase-10). Create a draft per
 * cycle, edit fields, attach evidence, submit/resubmit, withdraw while
 * non-terminal. The SIMULATED decision banner renders on every decision.
 */
export function AdmissionsApplyPage() {
  const { isLoading: authLoading } = useRequireAuth();
  const { locale, formatDateTime } = useI18n();
  const copy = admissionsMessages[locale];
  const [applications, setApplications] = useState<AdmissionApplication[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<ApplicationForm>(EMPTY_FORM);
  const [cycle, setCycle] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  // A 401/403 on the my-applications read is a denial, not an outage — show
  // the forbidden state instead of a retryable error.
  const [denied, setDenied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selected = applications.find((application) => application.id === selectedId) ?? null;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    setDenied(false);
    try {
      const rows = await admissionsApi.myApplications();
      setApplications(rows);
      setSelectedId((current) => (rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ''));
    } catch (cause) {
      const kind = campusErrorKind(cause);
      if (kind === 'forbidden' || kind === 'unauthorized') {
        setDenied(true);
      } else {
        setError(friendlyError(copy, cause));
      }
    } finally {
      setIsLoading(false);
    }
  }, [copy]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setForm(EMPTY_FORM);
      return;
    }
    setForm({
      fullName: selected.fullName ?? '',
      dateOfBirth: selected.dateOfBirth ?? '',
      schoolName: selected.schoolName ?? '',
      intendedMajor: selected.intendedMajor ?? '',
      essay: selected.essay ?? '',
    });
  }, [selectedId, selected?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const createDraft = async () => {
    if (!cycle.trim()) {
      toast.error(copy.failed);
      return;
    }
    setIsSaving(true);
    try {
      const created = await admissionsApi.create(cycle.trim(), newAdmissionsIdempotencyKey());
      toast.success(copy.created);
      setCycle('');
      await load();
      setSelectedId(created.id);
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsSaving(false);
    }
  };

  const save = async () => {
    if (!selected) {
      return;
    }
    setIsSaving(true);
    try {
      await admissionsApi.save(selected.id, form, selected.version);
      toast.success(copy.saved);
      await load();
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsSaving(false);
    }
  };

  const transition = async (kind: 'submit' | 'withdraw') => {
    if (!selected) {
      return;
    }
    setIsSaving(true);
    try {
      if (kind === 'submit') {
        await admissionsApi.submit(selected.id, selected.version, newAdmissionsIdempotencyKey());
        toast.success(copy.submitted);
      } else {
        await admissionsApi.withdraw(selected.id, selected.version, newAdmissionsIdempotencyKey());
        toast.success(copy.withdrawn);
      }
      await load();
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsSaving(false);
    }
  };

  const upload = async () => {
    if (!selected) {
      return;
    }
    try {
      const payload = await pickFileBase64(fileInputRef.current);
      if (!payload) {
        return;
      }
      await admissionsApi.uploadAttachment(selected.id, payload.fileName, payload.contentType,
        payload.dataBase64, newAdmissionsIdempotencyKey());
      toast.success(copy.uploaded);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await load();
    } catch (cause) {
      setError(friendlyError(copy, cause));
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    if (!selected) {
      return;
    }
    try {
      await admissionsApi.deleteAttachment(selected.id, attachmentId, newAdmissionsIdempotencyKey());
      toast.success(copy.removedAttachment);
      await load();
    } catch (cause) {
      setError(friendlyError(copy, cause));
    }
  };

  if (authLoading) {
    return <LoadingState />;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8" data-testid="admissions-apply-page">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
        title={copy.title}
        description={copy.description}
        actions={(
          <Button variant="outline" onClick={() => void load()} disabled={isLoading}>
            {copy.refresh}
          </Button>
        )}
      />

      <div className="mt-4 rounded-xl border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-status-warning-foreground" data-testid="admissions-simulated-banner">
        {copy.simulatedBanner}
      </div>

      {error ? <div className="mt-4"><ErrorState title={copy.failed} description={error} onRetry={() => void load()} /></div> : null}
      {denied ? <div className="mt-8"><WorkspaceForbiddenState /></div> : null}
      {isLoading ? <div className="mt-8"><LoadingState label={copy.loading} /></div> : null}

      {!isLoading && !error && !denied && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">{copy.myApplications}</h2>
            {applications.length === 0 ? (
              <EmptyState title={copy.emptyApplications} description="" />
            ) : (
              <ul className="space-y-3" data-testid="admissions-application-list">
                {applications.map((application) => (
                  <li key={application.id}>
                    <button
                      type="button"
                      data-testid={`admissions-application-${application.id}`}
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
                          <p className="font-medium">{application.fullName || application.cycle}</p>
                          <p className="text-xs text-muted-foreground">
                            {copy.cycle}: {application.cycle}
                          </p>
                        </div>
                        <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', statusToneClass(STATUS_TONE[application.status]))}>
                          {copy.statusLabels[application.status]}
                        </span>
                      </div>
                      {application.decision && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {copy.decision}: {copy.statusLabels[application.decision]}
                          {' '}({application.decisionLabel})
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-lg font-semibold">{copy.newApplication}</h2>
              <label className="mt-3 block text-sm text-muted-foreground">{copy.cycle}</label>
              <Input
                data-testid="admissions-cycle-input"
                value={cycle}
                onChange={(event) => setCycle(event.target.value)}
                placeholder={copy.cyclePlaceholder}
                className="mt-1"
              />
              <Button
                data-testid="admissions-create"
                className="mt-3 w-full"
                onClick={() => void createDraft()}
                disabled={isSaving || !cycle.trim()}
              >
                {copy.createDraft}
              </Button>
            </div>

            {selected && (
              <div className="rounded-xl border border-border bg-card p-4" data-testid="admissions-detail">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{copy.form}</h2>
                  <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', statusToneClass(STATUS_TONE[selected.status]))} data-testid="admissions-status">
                    {copy.statusLabels[selected.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isEditable(selected) && (selected.status === 'RETURNED' ? copy.returnedHint : copy.editableHint)}
                  {!isEditable(selected) && !isTerminal(selected) && copy.lockedHint}
                  {isTerminal(selected) && copy.terminalHint}
                </p>
                {selected.decision && (
                  <p className="mt-2 rounded-lg border border-border px-3 py-2 text-sm font-medium" data-testid="admissions-decision-label">
                    {copy.decision}: {copy.statusLabels[selected.decision]} — {selected.decisionLabel}
                  </p>
                )}

                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-sm text-muted-foreground">{copy.fullName}</label>
                    <Input
                      data-testid="admissions-fullname"
                      value={form.fullName}
                      disabled={!isEditable(selected)}
                      onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">{copy.dateOfBirth}</label>
                    <Input
                      data-testid="admissions-dob"
                      type="date"
                      value={form.dateOfBirth}
                      disabled={!isEditable(selected)}
                      onChange={(event) => setForm((current) => ({ ...current, dateOfBirth: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">{copy.schoolName}</label>
                    <Input
                      data-testid="admissions-school"
                      value={form.schoolName}
                      disabled={!isEditable(selected)}
                      onChange={(event) => setForm((current) => ({ ...current, schoolName: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">{copy.intendedMajor}</label>
                    <Input
                      data-testid="admissions-major"
                      value={form.intendedMajor}
                      disabled={!isEditable(selected)}
                      onChange={(event) => setForm((current) => ({ ...current, intendedMajor: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">{copy.essay}</label>
                    <Textarea
                      data-testid="admissions-essay"
                      value={form.essay}
                      disabled={!isEditable(selected)}
                      onChange={(event) => setForm((current) => ({ ...current, essay: event.target.value }))}
                      rows={4}
                    />
                  </div>
                </div>

                {isEditable(selected) && (
                  <div className="mt-4 flex gap-2">
                    <Button data-testid="admissions-save" onClick={() => void save()} disabled={isSaving}>
                      {copy.save}
                    </Button>
                    <Button
                      data-testid="admissions-submit"
                      variant="outline"
                      onClick={() => void transition('submit')}
                      disabled={isSaving}
                    >
                      {selected.status === 'RETURNED' ? copy.resubmit : copy.submit}
                    </Button>
                  </div>
                )}
                {!isTerminal(selected) && (
                  <Button
                    data-testid="admissions-withdraw"
                    variant="ghost"
                    className="mt-2 text-destructive"
                    onClick={() => void transition('withdraw')}
                    disabled={isSaving}
                  >
                    {copy.withdraw}
                  </Button>
                )}

                <div className="mt-6">
                  <h3 className="font-semibold">{copy.attachments}</h3>
                  {selected.attachments.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">{copy.attachmentsEmpty}</p>
                  ) : (
                    <ul className="mt-2 space-y-2" data-testid="admissions-attachments">
                      {selected.attachments.map((attachment) => (
                        <li key={attachment.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                          <span className="truncate">{attachment.fileName}</span>
                          <span className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void admissionsApi.downloadAttachment(selected.id, attachment.id, attachment.fileName)}
                            >
                              {copy.download}
                            </Button>
                            {isEditable(selected) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => void removeAttachment(attachment.id)}
                              >
                                {copy.remove}
                              </Button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {isEditable(selected) && (
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        data-testid="admissions-file-input"
                        type="file"
                        accept={UPLOAD_ACCEPT_DOCUMENTS}
                        className="text-sm"
                        aria-label={copy.attachFile}
                      />
                      <Button size="sm" variant="outline" data-testid="admissions-upload" onClick={() => void upload()}>
                        {copy.attachFile}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mt-6">
                  <h3 className="font-semibold">{copy.reviews}</h3>
                  {selected.reviews.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">{copy.reviewsEmpty}</p>
                  ) : (
                    <ol className="mt-2 space-y-2" data-testid="admissions-reviews">
                      {selected.reviews.map((review) => (
                        <li key={review.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{copy.reviewActions[review.action]}</span>
                            <span className="text-xs text-muted-foreground">
                              {review.createdAt ? formatDateTime(review.createdAt) : ''}
                            </span>
                          </div>
                          {review.note && <p className="mt-1 text-muted-foreground">{review.note}</p>}
                          {review.decision && (
                            <p className="mt-1 font-medium">
                              {copy.statusLabels[review.decision]}
                            </p>
                          )}
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
