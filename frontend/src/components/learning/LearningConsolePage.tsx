'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  RefreshCw,
  Send,
  Upload,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRequireAuth } from '@/context/AuthContext';
import {
  learningApi,
  newLearningIdempotencyKey,
  readFilePayload,
  type FilePayload,
  type LearningAssignment,
  type LearningFeedback,
  type LearningMaterial,
  type LearningRevision,
  type LearningRosterRow,
  type LearningSection,
  type LearningSubmission,
} from '@/lib/learning-api';
import { sectionsApi } from '@/lib/api';
import type { GradingSection } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { statusToneClass } from '@/components/ui/status';
import { learningMessages } from '@/i18n/learning-messages';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

type Copy = (typeof learningMessages)['vi'];

function assignmentTone(status: string) {
  switch (status) {
    case 'PUBLISHED': return 'info' as const;
    case 'CLOSED': return 'warning' as const;
    case 'ARCHIVED': return 'neutral' as const;
    default: return 'neutral' as const;
  }
}

function submissionTone(status: string | null) {
  switch (status) {
    case 'SUBMITTED': case 'RESUBMITTED': return 'info' as const;
    case 'REVIEWED': return 'success' as const;
    case 'RETURNED': return 'warning' as const;
    default: return 'neutral' as const;
  }
}

function errorCode(error: unknown): string {
  return String((error as { response?: { data?: { code?: string } } })?.response?.data?.code ?? '');
}

function friendlyError(copy: Copy, error: unknown): string {
  const code = errorCode(error);
  if (code === 'NOT_ENROLLED' || code === 'ENROLLMENT_NOT_ACTIVE') return copy.notEnrolled;
  if (code === 'ASSIGNMENT_NOT_OPEN' || code === 'DEADLINE_PASSED') return copy.pastDeadline;
  return copy.failed;
}

async function pickFile(input: HTMLInputElement | null): Promise<FilePayload | null> {
  const file = input?.files?.[0];
  return file ? readFilePayload(file) : null;
}

// ---------------------------------------------------------------------------
// Student surface — enrolled-section roster → materials → work lifecycle
// ---------------------------------------------------------------------------

export function StudentLearningPage() {
  const { isLoading: authLoading } = useRequireAuth(['STUDENT']);
  const { locale, formatDateTime } = useI18n();
  const copy = learningMessages[locale];
  const [sections, setSections] = useState<LearningSection[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [assignments, setAssignments] = useState<LearningAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [workAssignment, setWorkAssignment] = useState<LearningAssignment | null>(null);

  const loadSections = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const rows = await learningApi.mySections();
      setSections(rows);
      setSectionId((current) => (rows.some((row) => row.sectionId === current) ? current : rows[0]?.sectionId ?? ''));
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsLoading(false);
    }
  }, [copy]);

  const loadSection = useCallback(async (id: string) => {
    if (!id) {
      setMaterials([]);
      setAssignments([]);
      return;
    }
    try {
      const [materialRows, assignmentRows] = await Promise.all([
        learningApi.materials(id),
        learningApi.assignments(id),
      ]);
      setMaterials(materialRows);
      setAssignments(assignmentRows);
    } catch (cause) {
      toast.error(friendlyError(copy, cause));
    }
  }, [copy]);

  useEffect(() => { if (!authLoading) void loadSections(); }, [authLoading, loadSections]);
  useEffect(() => { void loadSection(sectionId); }, [sectionId, loadSection]);

  if (authLoading || isLoading) return <LoadingState label={copy.loading} />;
  if (error) return <ErrorState title={copy.failed} description={error} />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
        title={copy.title}
        description={copy.studentHint}
        actions={(
          <Button variant="outline" size="sm" onClick={() => void loadSections()}>
            <RefreshCw className="mr-2 h-4 w-4" />{copy.refresh}
          </Button>
        )}
      />

      {sections.length === 0 ? (
        <EmptyState title={copy.emptySections} description="" />
      ) : (
        <>
          <div className="flex flex-wrap gap-2" data-testid="learning-sections">
            {sections.map((section) => (
              <button
                key={section.sectionId}
                type="button"
                onClick={() => setSectionId(section.sectionId)}
                data-testid={`learning-section-${section.sectionId}`}
                className={cn(
                  'rounded-xl border px-4 py-2 text-left text-sm transition',
                  section.sectionId === sectionId
                    ? 'border-primary bg-primary/10 font-semibold'
                    : 'border-border hover:bg-muted',
                )}
              >
                <span className="block font-medium">{section.courseCode} · {section.sectionNumber}</span>
                <span className="block text-xs text-muted-foreground">{section.courseName}</span>
              </button>
            ))}
          </div>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border p-5" data-testid="learning-materials">
              <h2 className="mb-4 flex items-center gap-2 font-semibold">
                <FileText className="h-4 w-4" />{copy.materials}
              </h2>
              {materials.length === 0 ? (
                <EmptyState title={copy.materialsEmpty} description="" />
              ) : (
                <ul className="space-y-3">
                  {materials.map((material) => (
                    <li key={material.id} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{material.title}</p>
                        {material.description ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{material.description}</p>
                        ) : null}
                        {material.fileName ? (
                          <p className="mt-1 text-xs text-muted-foreground">{material.fileName}</p>
                        ) : null}
                      </div>
                      {material.fileName ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void learningApi.downloadMaterial(material.id, material.fileName ?? 'material').catch(() => toast.error(copy.failed))}
                        >
                          <Download className="mr-1 h-3 w-3" />{copy.download}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-border p-5" data-testid="learning-assignments">
              <h2 className="mb-4 flex items-center gap-2 font-semibold">
                <ClipboardCheck className="h-4 w-4" />{copy.assignments}
              </h2>
              {assignments.length === 0 ? (
                <EmptyState title={copy.assignmentsEmpty} description="" />
              ) : (
                <ul className="space-y-3">
                  {assignments.map((assignment) => (
                    <li key={assignment.id} className="rounded-xl border border-border p-3" data-testid={`assignment-${assignment.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{assignment.title}</p>
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {assignment.deadlineAt ? formatDateTime(assignment.deadlineAt) : '—'}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className={cn('rounded-full px-2 py-0.5 text-xs', statusToneClass(assignmentTone(assignment.status)))}>
                            {copy.statusLabels[assignment.status] ?? assignment.status}
                          </span>
                          {assignment.mySubmissionStatus ? (
                            <span className={cn('rounded-full px-2 py-0.5 text-xs', statusToneClass(submissionTone(assignment.mySubmissionStatus)))}>
                              {copy.statusLabels[assignment.mySubmissionStatus] ?? assignment.mySubmissionStatus}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {assignment.description ? (
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{assignment.description}</p>
                      ) : null}
                      <div className="mt-3">
                        <Button size="sm" variant="outline" onClick={() => setWorkAssignment(assignment)}>
                          <Send className="mr-1 h-3 w-3" />{copy.openAssignment}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}

      <StudentWorkModal
        assignment={workAssignment}
        copy={copy}
        onClose={() => setWorkAssignment(null)}
        onChanged={() => void loadSection(sectionId)}
      />
    </div>
  );
}

function StudentWorkModal({
  assignment,
  copy,
  onClose,
  onChanged,
}: {
  assignment: LearningAssignment | null;
  copy: Copy;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { formatDateTime } = useI18n();
  const [submission, setSubmission] = useState<LearningSubmission | null>(null);
  const [revisions, setRevisions] = useState<LearningRevision[]>([]);
  const [feedback, setFeedback] = useState<LearningFeedback[]>([]);
  const [textBody, setTextBody] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const idemKey = useRef(newLearningIdempotencyKey());

  const refresh = useCallback(async (submissionId: string) => {
    const [detail, revisionRows, feedbackRows] = await Promise.all([
      learningApi.mySubmission(submissionId),
      learningApi.myRevisions(submissionId),
      learningApi.myFeedback(submissionId),
    ]);
    setSubmission(detail);
    setRevisions(revisionRows);
    setFeedback(feedbackRows);
  }, []);

  useEffect(() => {
    setSubmission(null);
    setRevisions([]);
    setFeedback([]);
    setTextBody('');
    idemKey.current = newLearningIdempotencyKey();
    if (assignment?.mySubmissionId) {
      void refresh(assignment.mySubmissionId).catch(() => toast.error(copy.failed));
    }
  }, [assignment, copy, refresh]);

  const editable = submission == null || submission.status === 'DRAFT' || submission.status === 'RETURNED';

  const run = async (action: () => Promise<LearningSubmission>, ok: string) => {
    if (!assignment) return;
    setBusy(true);
    try {
      const result = await action();
      setSubmission(result);
      await refresh(result.id);
      toast.success(ok);
      onChanged();
    } catch (cause) {
      toast.error(friendlyError(copy, cause));
    } finally {
      setBusy(false);
    }
  };

  const ensureDraft = () => run(
    () => learningApi.openDraft(assignment!.id, idemKey.current), copy.draftSaved);

  const save = () => run(async () => {
    const file = await pickFile(fileRef.current);
    return learningApi.saveDraft(submission!.id, {
      textBody: textBody || null,
      ...(file ?? {}),
    });
  }, copy.draftSaved);

  const submit = () => run(
    () => learningApi.submit(assignment!.id, idemKey.current), copy.submittedOk);

  const resubmit = () => run(async () => {
    const file = await pickFile(fileRef.current);
    return learningApi.resubmit(assignment!.id, {
      textBody: textBody || null,
      ...(file ?? {}),
    }, idemKey.current);
  }, copy.submittedOk);

  return (
    <Modal isOpen={assignment != null} onClose={onClose} title={assignment?.title ?? ''}>
      {assignment ? (
        <div className="space-y-4" data-testid="learning-work">
          <p className="text-xs text-muted-foreground">
            {copy.deadline}: {assignment.deadlineAt ? formatDateTime(assignment.deadlineAt) : '—'}
          </p>

          {submission == null ? (
            <Button onClick={() => void ensureDraft()} disabled={busy || assignment.status !== 'PUBLISHED'}>
              <Upload className="mr-2 h-4 w-4" />{copy.draftWork}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={cn('rounded-full px-2 py-0.5 text-xs', statusToneClass(submissionTone(submission.status)))}>
                  {copy.statusLabels[submission.status] ?? submission.status}
                </span>
                {submission.submittedAt ? (
                  <span className="text-xs text-muted-foreground">{formatDateTime(submission.submittedAt)}</span>
                ) : null}
              </div>

              {editable ? (
                <div className="space-y-2" data-testid="learning-draft-form">
                  <label className="block text-xs font-medium">{copy.writeAnswer}</label>
                  <textarea
                    className="min-h-28 w-full rounded-lg border border-border bg-background p-2 text-sm"
                    value={textBody}
                    onChange={(event) => setTextBody(event.target.value)}
                  />
                  <label className="block text-xs font-medium">{copy.attachFile}</label>
                  <input ref={fileRef} type="file" className="block w-full text-xs" data-testid="learning-file-input" />
                  <div className="flex flex-wrap gap-2">
                    {submission.status === 'DRAFT' ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => void save()} disabled={busy}>
                          {copy.saveDraft}
                        </Button>
                        <Button size="sm" onClick={() => void submit()} disabled={busy}>
                          <Send className="mr-1 h-3 w-3" />{copy.submitWork}
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" onClick={() => void resubmit()} disabled={busy}>
                        <Send className="mr-1 h-3 w-3" />{copy.resubmitWork}
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}

              {revisions.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {copy.revisions}
                  </h3>
                  <ul className="space-y-2">
                    {revisions.map((revision) => (
                      <li key={revision.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-xs">
                        <span>#{revision.revisionNo} · {formatDateTime(revision.submittedAt)}{revision.fileName ? ` · ${revision.fileName}` : ''}</span>
                        {revision.fileName ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void learningApi.downloadRevision(revision.id, revision.fileName ?? 'submission').catch(() => toast.error(copy.failed))}
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {copy.feedback}
                </h3>
                {feedback.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{copy.feedbackEmpty}</p>
                ) : (
                  <ul className="space-y-2" data-testid="learning-feedback">
                    {feedback.map((row) => (
                      <li key={row.id} className="rounded-lg border border-border p-2 text-xs">
                        {row.score != null ? <span className="font-semibold">{row.score}</span> : null}
                        {row.comment ? <p className="mt-1">{row.comment}</p> : null}
                        <p className="mt-1 text-muted-foreground">{formatDateTime(row.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Lecturer surface — assigned sections → materials + assignment lifecycle +
// submission roster → return/review (official grade authority untouched)
// ---------------------------------------------------------------------------

export function LecturerLearningPage() {
  const { isLoading: authLoading } = useRequireAuth(['LECTURER']);
  const { locale, formatDateTime } = useI18n();
  const copy = learningMessages[locale];
  const [sections, setSections] = useState<GradingSection[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [assignments, setAssignments] = useState<LearningAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [materialOpen, setMaterialOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [rosterAssignment, setRosterAssignment] = useState<LearningAssignment | null>(null);

  const loadSections = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const rows = await sectionsApi.getMyGradingSections();
      setSections(rows);
      const first = rows[0]?.id ?? '';
      setSectionId((current) => (rows.some((row) => row.id === current) ? current : first));
    } catch (cause) {
      setError(friendlyError(copy, cause));
    } finally {
      setIsLoading(false);
    }
  }, [copy]);

  const loadSection = useCallback(async (id: string) => {
    if (!id) {
      setMaterials([]);
      setAssignments([]);
      return;
    }
    try {
      const [materialRows, assignmentRows] = await Promise.all([
        learningApi.staffMaterials(id),
        learningApi.staffAssignments(id),
      ]);
      setMaterials(materialRows);
      setAssignments(assignmentRows);
    } catch (cause) {
      toast.error(friendlyError(copy, cause));
    }
  }, [copy]);

  useEffect(() => { if (!authLoading) void loadSections(); }, [authLoading, loadSections]);
  useEffect(() => { void loadSection(sectionId); }, [sectionId, loadSection]);

  if (authLoading || isLoading) return <LoadingState label={copy.loading} />;
  if (error) return <ErrorState title={copy.failed} description={error} />;

  const lifecycle = (assignment: LearningAssignment) => (
    <div className="flex flex-wrap gap-1">
      {assignment.status === 'DRAFT' ? (
        <Button size="sm" variant="outline" onClick={() => void staffAction(() => learningApi.staffPublish(assignment.id), copy.updated)}>
          {copy.publish}
        </Button>
      ) : null}
      {assignment.status === 'PUBLISHED' ? (
        <Button size="sm" variant="outline" onClick={() => void staffAction(() => learningApi.staffClose(assignment.id), copy.updated)}>
          {copy.closeAssignment}
        </Button>
      ) : null}
      {assignment.status === 'CLOSED' ? (
        <Button size="sm" variant="outline" onClick={() => void staffAction(() => learningApi.staffArchive(assignment.id), copy.updated)}>
          {copy.archive}
        </Button>
      ) : null}
    </div>
  );

  const staffAction = async (action: () => Promise<unknown>, ok: string) => {
    try {
      await action();
      toast.success(ok);
      await loadSection(sectionId);
    } catch (cause) {
      toast.error(friendlyError(copy, cause));
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
        title={copy.title}
        description={copy.staffHint}
        actions={(
          <Button variant="outline" size="sm" onClick={() => void loadSections()}>
            <RefreshCw className="mr-2 h-4 w-4" />{copy.refresh}
          </Button>
        )}
      />

      {sections.length === 0 ? (
        <EmptyState title={copy.emptyLecturerSections} description="" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium">{copy.pickSection}</label>
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
              data-testid="learning-staff-section"
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.courseCode} · {section.sectionNumber} — {section.courseName}
                </option>
              ))}
            </select>
          </div>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border p-5" data-testid="learning-staff-materials">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  <FileText className="h-4 w-4" />{copy.materials}
                </h2>
                <Button size="sm" variant="outline" onClick={() => setMaterialOpen(true)}>
                  {copy.addMaterial}
                </Button>
              </div>
              {materials.length === 0 ? (
                <EmptyState title={copy.materialsEmpty} description="" />
              ) : (
                <ul className="space-y-3">
                  {materials.map((material) => (
                    <li key={material.id} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{material.title}</p>
                        {material.fileName ? (
                          <p className="mt-1 text-xs text-muted-foreground">{material.fileName}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {material.fileName ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void learningApi.staffDownloadMaterial(material.id, material.fileName ?? 'material').catch(() => toast.error(copy.failed))}
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void staffAction(() => learningApi.staffDeleteMaterial(material.id, material.version), copy.deleted)}
                        >
                          ×
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-border p-5" data-testid="learning-staff-assignments">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  <ClipboardCheck className="h-4 w-4" />{copy.assignments}
                </h2>
                <Button size="sm" variant="outline" onClick={() => setAssignmentOpen(true)}>
                  {copy.addAssignment}
                </Button>
              </div>
              {assignments.length === 0 ? (
                <EmptyState title={copy.assignmentsEmpty} description="" />
              ) : (
                <ul className="space-y-3">
                  {assignments.map((assignment) => (
                    <li key={assignment.id} className="rounded-xl border border-border p-3" data-testid={`staff-assignment-${assignment.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{assignment.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {assignment.deadlineAt ? formatDateTime(assignment.deadlineAt) : '—'}
                            {assignment.maxScore != null ? ` · ${assignment.maxScore}` : ''}
                          </p>
                        </div>
                        <span className={cn('rounded-full px-2 py-0.5 text-xs', statusToneClass(assignmentTone(assignment.status)))}>
                          {copy.statusLabels[assignment.status] ?? assignment.status}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        {lifecycle(assignment)}
                        <Button size="sm" variant="outline" onClick={() => setRosterAssignment(assignment)}>
                          <Users className="mr-1 h-3 w-3" />{copy.roster}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}

      <MaterialModal
        sectionId={sectionId}
        open={materialOpen}
        copy={copy}
        onClose={() => setMaterialOpen(false)}
        onDone={() => void loadSection(sectionId)}
      />
      <AssignmentModal
        sectionId={sectionId}
        open={assignmentOpen}
        copy={copy}
        onClose={() => setAssignmentOpen(false)}
        onDone={() => void loadSection(sectionId)}
      />
      <RosterModal
        assignment={rosterAssignment}
        copy={copy}
        onClose={() => setRosterAssignment(null)}
      />
    </div>
  );
}

function MaterialModal({
  sectionId, open, copy, onClose, onDone,
}: {
  sectionId: string;
  open: boolean;
  copy: Copy;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const file = await pickFile(fileRef.current);
      await learningApi.staffCreateMaterial(sectionId, {
        title,
        description: description || null,
        ...(file ?? {}),
      });
      toast.success(copy.created);
      setTitle('');
      setDescription('');
      if (fileRef.current) fileRef.current.value = '';
      onDone();
      onClose();
    } catch (cause) {
      toast.error(friendlyError(copy, cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={copy.addMaterial}>
      <div className="space-y-3">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={copy.materialTitle} />
        <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={copy.descriptionField} />
        <label className="block text-xs font-medium">{copy.materialFile}</label>
        <input ref={fileRef} type="file" className="block w-full text-xs" data-testid="learning-material-file" />
        <Button onClick={() => void create()} disabled={busy || !title.trim()}>{copy.addMaterial}</Button>
      </div>
    </Modal>
  );
}

function AssignmentModal({
  sectionId, open, copy, onClose, onDone,
}: {
  sectionId: string;
  open: boolean;
  copy: Copy;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await learningApi.staffCreateAssignment(sectionId, {
        title,
        description: description || null,
        deadlineAt: deadline ? new Date(deadline).toISOString() : null,
        maxScore: maxScore ? Number(maxScore) : null,
      });
      toast.success(copy.created);
      setTitle('');
      setDescription('');
      setDeadline('');
      setMaxScore('');
      onDone();
      onClose();
    } catch (cause) {
      toast.error(friendlyError(copy, cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={copy.addAssignment}>
      <div className="space-y-3">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={copy.assignmentTitle} />
        <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={copy.descriptionField} />
        <label className="block text-xs font-medium">{copy.deadline}</label>
        <input
          type="datetime-local"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
          data-testid="learning-assignment-deadline"
        />
        <Input
          value={maxScore}
          onChange={(event) => setMaxScore(event.target.value)}
          placeholder={copy.maxScore}
          type="number"
        />
        <Button onClick={() => void create()} disabled={busy || !title.trim()}>{copy.addAssignment}</Button>
      </div>
    </Modal>
  );
}

function RosterModal({
  assignment, copy, onClose,
}: {
  assignment: LearningAssignment | null;
  copy: Copy;
  onClose: () => void;
}) {
  const { formatDateTime } = useI18n();
  const [rows, setRows] = useState<LearningRosterRow[]>([]);
  const [work, setWork] = useState<LearningSubmission | null>(null);
  const [revisions, setRevisions] = useState<LearningRevision[]>([]);
  const [feedback, setFeedback] = useState<LearningFeedback[]>([]);
  const [comment, setComment] = useState('');
  const [score, setScore] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!assignment) return;
    try {
      setRows(await learningApi.staffRoster(assignment.id));
    } catch (cause) {
      toast.error(friendlyError(copy, cause));
    }
  }, [assignment, copy]);

  useEffect(() => {
    setRows([]);
    setWork(null);
    setRevisions([]);
    setFeedback([]);
    setComment('');
    setScore('');
    void load();
  }, [load]);

  const openWork = async (submissionId: string) => {
    try {
      const [detail, revisionRows, feedbackRows] = await Promise.all([
        learningApi.staffSubmission(submissionId),
        learningApi.staffRevisions(submissionId),
        learningApi.staffFeedback(submissionId),
      ]);
      setWork(detail);
      setRevisions(revisionRows);
      setFeedback(feedbackRows);
    } catch (cause) {
      toast.error(friendlyError(copy, cause));
    }
  };

  const grade = async (action: 'return' | 'review') => {
    if (!work) return;
    setBusy(true);
    try {
      const payload = {
        comment: comment || null,
        score: score ? Number(score) : null,
        expectedVersion: work.version,
      };
      const result = action === 'return'
        ? await learningApi.staffReturn(work.id, { comment: comment || '', score: payload.score, expectedVersion: work.version })
        : await learningApi.staffReview(work.id, payload);
      setWork(result);
      toast.success(action === 'return' ? copy.returnedOk : copy.reviewedOk);
      await openWork(result.id);
      await load();
    } catch (cause) {
      toast.error(friendlyError(copy, cause));
    } finally {
      setBusy(false);
    }
  };

  const reviewable = work != null && (work.status === 'SUBMITTED' || work.status === 'RESUBMITTED' || work.status === 'RETURNED');

  return (
    <Modal isOpen={assignment != null} onClose={onClose} title={`${copy.roster} — ${assignment?.title ?? ''}`}>
      <div className="space-y-4" data-testid="learning-roster">
        {rows.length === 0 ? (
          <EmptyState title={copy.rosterEmpty} description="" />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.enrollmentId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2 text-sm" data-testid={`roster-${row.enrollmentId}`} data-student-id={row.studentId}>
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.studentName ?? row.studentId}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.studentEmail}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs', statusToneClass(submissionTone(row.submissionStatus)))}>
                    {row.submissionStatus ? (copy.statusLabels[row.submissionStatus] ?? row.submissionStatus) : copy.noSubmission}
                  </span>
                  {row.submissionId ? (
                    <Button size="sm" variant="ghost" onClick={() => void openWork(row.submissionId!)}>
                      {copy.viewWork}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {work ? (
          <div className="space-y-3 rounded-xl border border-border p-3" data-testid="learning-staff-work">
            <div className="flex items-center gap-2">
              <span className={cn('rounded-full px-2 py-0.5 text-xs', statusToneClass(submissionTone(work.status)))}>
                {copy.statusLabels[work.status] ?? work.status}
              </span>
              <span className="text-xs text-muted-foreground">
                {work.studentName} · {work.submittedAt ? formatDateTime(work.submittedAt) : '—'}
              </span>
            </div>

            {revisions.length > 0 ? (
              <ul className="space-y-1">
                {revisions.map((revision) => (
                  <li key={revision.id} className="flex items-center justify-between text-xs">
                    <span>#{revision.revisionNo} · {formatDateTime(revision.submittedAt)}{revision.fileName ? ` · ${revision.fileName}` : ''}</span>
                    {revision.fileName ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void learningApi.staffDownloadRevision(revision.id, revision.fileName ?? 'submission').catch(() => toast.error(copy.failed))}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {revisions[0]?.textBody ? (
              <p className="rounded-lg bg-muted p-2 text-xs" data-testid="learning-revision-text">{revisions[0].textBody}</p>
            ) : null}

            {feedback.length > 0 ? (
              <ul className="space-y-1 text-xs" data-testid="learning-staff-feedback">
                {feedback.map((row) => (
                  <li key={row.id} className="rounded-lg border border-border p-2">
                    {row.score != null ? <span className="font-semibold">{row.score} · </span> : null}
                    {row.comment}
                  </li>
                ))}
              </ul>
            ) : null}

            {reviewable ? (
              <div className="space-y-2" data-testid="learning-grade-form">
                <Input value={comment} onChange={(event) => setComment(event.target.value)} placeholder={copy.comment} />
                <Input value={score} onChange={(event) => setScore(event.target.value)} placeholder={copy.score} type="number" />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void grade('return')} disabled={busy || !comment.trim()}>
                    {copy.returnWork}
                  </Button>
                  <Button size="sm" onClick={() => void grade('review')} disabled={busy}>
                    <CheckCircle2 className="mr-1 h-3 w-3" />{copy.reviewWork}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
