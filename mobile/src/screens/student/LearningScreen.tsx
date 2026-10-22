import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  DataNotice,
  Divider,
  Field,
  ListRow,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import {
  ApiClientError,
  apiClient,
  campusApi,
  type MobileLearningAssignment,
  type MobileLearningFeedback,
  type MobileLearningMaterial,
  type MobileLearningRevision,
  type MobileLearningSection,
  type MobileLearningSubmission,
} from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { learningMessages, type LearningLocale } from '../../i18n/learning-messages';
import type { MobileScreenProps } from '../../navigation/types';

/**
 * D5 student learning surface (P09): enrolled-section roster read-through,
 * materials, assignments and the draft→submit→resubmit lifecycle. Native is
 * the text lane — file picking is the P13 device-matrix scope; deadline and
 * revision immutability stay server-enforced (LMS-X01/X02).
 */
const previewSections: MobileLearningSection[] = [
  {
    sectionId: 'preview-sec-1',
    sectionNumber: '01',
    courseCode: 'CS101',
    courseName: 'Introduction to Programming',
    enrollmentStatus: 'ENROLLED',
    materialCount: 2,
    assignmentCount: 1,
  },
];

const previewMaterials: MobileLearningMaterial[] = [
  {
    id: 'preview-mat-1',
    sectionId: 'preview-sec-1',
    title: 'Week 1 — syllabus & toolchain',
    fileName: 'week1-syllabus.pdf',
    version: 1,
  },
];

const previewAssignments: MobileLearningAssignment[] = [
  {
    id: 'preview-asg-1',
    sectionId: 'preview-sec-1',
    title: 'Lab 1 — first program',
    deadlineAt: '2026-11-15T23:59:00Z',
    maxScore: 10,
    status: 'PUBLISHED',
    version: 1,
    mySubmissionId: null,
    mySubmissionStatus: null,
  },
];

function deadlineLabel(assignment: MobileLearningAssignment, copy: typeof learningMessages['vi'], locale: LearningLocale): string {
  if (!assignment.deadlineAt) return copy.noDeadline;
  const when = new Date(assignment.deadlineAt);
  const text = Number.isNaN(when.getTime())
    ? assignment.deadlineAt
    : when.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US');
  return `${copy.deadline}: ${text}`;
}

export function LearningScreen(_props: MobileScreenProps) {
  const [locale, setLocale] = useState<LearningLocale>('vi');
  const copy = learningMessages[locale];
  const statusLabel = (status: string) => copy.statusLabels[status] ?? status;
  const languageSelector = (
    <View style={styles.actionRow}>
      <UiText>{copy.language}</UiText>
      {(['vi', 'en'] as const).map((option) => (
        <Button
          key={option}
          label={option.toUpperCase()}
          accessibilityLabel={option === 'vi' ? 'Tiếng Việt' : 'English'}
          variant={locale === option ? 'primary' : 'secondary'}
          onPress={() => setLocale(option)}
        />
      ))}
    </View>
  );

  const [sectionId, setSectionId] = useState<string | null>(null);
  const [workAssignment, setWorkAssignment] = useState<MobileLearningAssignment | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isPreview = apiClient.mode === 'preview';

  const sectionsQuery = useScreenQuery<MobileLearningSection[]>(
    'learning.sections',
    () => campusApi.learningSections(),
    {
      enabled: apiClient.mode === 'live',
      errorMessage: copy.sectionsUnavailable,
      mapError: () => copy.sectionsUnavailable,
    },
  );

  const sections = isPreview ? previewSections : sectionsQuery.data ?? [];
  const activeSectionId = sectionId ?? sections[0]?.sectionId ?? null;

  const materialsQuery = useScreenQuery<MobileLearningMaterial[]>(
    `learning.materials.${activeSectionId ?? 'none'}`,
    () => campusApi.learningMaterials(activeSectionId as string),
    {
      enabled: apiClient.mode === 'live' && activeSectionId != null,
      errorMessage: copy.unavailable,
      mapError: () => copy.unavailable,
    },
  );
  const assignmentsQuery = useScreenQuery<MobileLearningAssignment[]>(
    `learning.assignments.${activeSectionId ?? 'none'}`,
    () => campusApi.learningAssignments(activeSectionId as string),
    {
      enabled: apiClient.mode === 'live' && activeSectionId != null,
      errorMessage: copy.unavailable,
      mapError: () => copy.unavailable,
    },
  );

  const materials = isPreview ? previewMaterials : materialsQuery.data ?? [];
  const assignments = isPreview ? previewAssignments : assignmentsQuery.data ?? [];

  const reloadAll = useCallback(() => {
    void sectionsQuery.reload();
    void materialsQuery.reload();
    void assignmentsQuery.reload();
  }, [sectionsQuery, materialsQuery, assignmentsQuery]);

  const friendlyMutation = useCallback(
    (error: unknown): string => {
      const code = error instanceof ApiClientError ? error.code : '';
      if (code === 'NOT_ENROLLED' || code === 'ENROLLMENT_NOT_ACTIVE') return copy.notEnrolled;
      if (code === 'ASSIGNMENT_NOT_OPEN' || code === 'DEADLINE_PASSED') return copy.pastDeadline;
      return copy.submitFailed;
    },
    [copy],
  );

  const run = useCallback(
    async (action: () => Promise<MobileLearningSubmission>, ok: string) => {
      if (isPreview || mutating) return;
      setMutating(true);
      setMutationError(null);
      setNotice(null);
      try {
        await action();
        setNotice(ok);
        reloadAll();
      } catch (error) {
        setMutationError(friendlyMutation(error));
      } finally {
        setMutating(false);
      }
    },
    [friendlyMutation, isPreview, mutating, reloadAll],
  );

  const isLoading =
    !isPreview &&
    (sectionsQuery.isLoading ||
      (activeSectionId != null && (materialsQuery.isLoading || assignmentsQuery.isLoading)));
  const error = !isPreview
    ? sectionsQuery.error ?? materialsQuery.error ?? assignmentsQuery.error
    : null;
  const warning = !isPreview
    ? sectionsQuery.warning ?? materialsQuery.warning ?? assignmentsQuery.warning
    : null;

  if (isLoading || error) {
    return (
      <ScreenShell title={copy.title} eyebrow={copy.eyebrow} subtitle={copy.subtitle}>
        {languageSelector}
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? copy.loading : copy.errorTitle}
          description={error ?? copy.retrieving}
          actionLabel={error ? copy.retry : undefined}
          onAction={error ? reloadAll : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title={copy.title} eyebrow={copy.eyebrow} subtitle={copy.subtitle}>
      {languageSelector}
      {warning ? <DataNotice message={warning} /> : null}
      {mutationError ? <StatePanel kind="error" title={mutationError} /> : null}
      {notice ? <DataNotice message={notice} /> : null}

      <SectionHeading title={copy.sections} />
      {sections.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptySections} description={copy.emptySectionsDescription} />
      ) : (
        <Card>
          {sections.map((section, index) => (
            <View key={section.sectionId}>
              <ListRow
                title={`${section.courseCode} · ${section.sectionNumber}`}
                subtitle={section.courseName}
                meta={`${section.assignmentCount}`}
                onPress={() => setSectionId(section.sectionId)}
              />
              {index < sections.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Card>
      )}

      <ScreenSpacer />
      <SectionHeading title={copy.materials} />
      {materials.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptyMaterials} description={copy.emptyMaterialsDescription} />
      ) : (
        <Card>
          {materials.map((material, index) => (
            <View key={material.id}>
              <ListRow
                title={material.title}
                subtitle={material.fileName ?? material.description ?? ''}
              />
              {index < materials.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Card>
      )}

      <ScreenSpacer />
      <SectionHeading title={copy.assignments} />
      {assignments.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptyAssignments} description={copy.emptyAssignmentsDescription} />
      ) : (
        <Card>
          {assignments.map((assignment, index) => (
            <View key={assignment.id}>
              <ListRow
                title={assignment.title}
                subtitle={deadlineLabel(assignment, copy, locale)}
                meta={statusLabel(assignment.status)}
              />
              <View style={styles.actionRow}>
                <UiText variant="meta" tone="muted">
                  {assignment.mySubmissionStatus ? statusLabel(assignment.mySubmissionStatus) : ''}
                </UiText>
                <Button
                  label={copy.openWork}
                  variant="secondary"
                  disabled={isPreview}
                  onPress={() => setWorkAssignment(assignment)}
                />
              </View>
              {index < assignments.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Card>
      )}

      <ScreenSpacer />

      {workAssignment ? (
        <Card>
          <UiText variant="bodyMedium">{workAssignment.title}</UiText>
          <UiText variant="meta" tone="muted">
            {deadlineLabel(workAssignment, copy, locale)}
          </UiText>
          <SubmissionWork
            assignment={workAssignment}
            mutating={mutating}
            disabled={isPreview}
            copy={copy}
            onRun={run}
            onClose={() => setWorkAssignment(null)}
          />
        </Card>
      ) : null}
      <ScreenSpacer />
    </ScreenShell>
  );
}

function SubmissionWork({
  assignment,
  mutating,
  disabled,
  copy,
  onRun,
  onClose,
}: {
  assignment: MobileLearningAssignment;
  mutating: boolean;
  disabled: boolean;
  copy: typeof learningMessages['vi'];
  onRun: (action: () => Promise<MobileLearningSubmission>, ok: string) => Promise<void>;
  onClose: () => void;
}) {
  const [submission, setSubmission] = useState<MobileLearningSubmission | null>(null);
  const [revisions, setRevisions] = useState<MobileLearningRevision[]>([]);
  const [feedback, setFeedback] = useState<MobileLearningFeedback[]>([]);
  const [text, setText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const submissionId = submission?.id ?? assignment.mySubmissionId ?? null;

  const refresh = useCallback(async () => {
    if (!submissionId) return;
    try {
      const [revisionRows, feedbackRows] = await Promise.all([
        campusApi.learningRevisions(submissionId),
        campusApi.learningFeedback(submissionId),
      ]);
      setRevisions(revisionRows);
      setFeedback(feedbackRows);
    } catch {
      setLoadError(copy.unavailable);
    }
  }, [copy, submissionId]);

  useEffect(() => {
    if (submissionId && !disabled) {
      void refresh();
    }
  }, [disabled, refresh, submissionId]);

  const openDraft = () => onRun(async () => {
    const created = await campusApi.learningOpenDraft(assignment.id);
    setSubmission(created);
    return created;
  }, copy.saved);

  const saveDraft = () => onRun(async () => {
    if (!submissionId) throw new Error('no-draft');
    const saved = await campusApi.learningSaveDraft(submissionId, text);
    setSubmission(saved);
    return saved;
  }, copy.saved);

  const submit = () => onRun(async () => {
    const done = await campusApi.learningSubmit(assignment.id);
    setSubmission(done);
    return done;
  }, copy.submitted);

  const resubmit = () => onRun(async () => {
    const done = await campusApi.learningResubmit(assignment.id, text);
    setSubmission(done);
    return done;
  }, copy.submitted);

  const status = submission?.status ?? assignment.mySubmissionStatus ?? null;
  const editable = status == null || status === 'DRAFT' || status === 'RETURNED';
  const published = assignment.status === 'PUBLISHED';

  return (
    <View style={styles.work}>
      {loadError ? <StatePanel kind="error" title={loadError} /> : null}
      {status ? (
        <UiText variant="meta" tone="muted">{copy.statusLabels[status] ?? status}</UiText>
      ) : null}

      {submissionId == null && published ? (
        <Button label={copy.draftWork} variant="secondary" loading={mutating} disabled={disabled} onPress={() => void openDraft()} />
      ) : null}

      {editable && submissionId ? (
        <View style={styles.workForm}>
          <Field
            label={copy.yourAnswer}
            placeholder={copy.answerPlaceholder}
            value={text}
            onChangeText={setText}
            multiline
            numberOfLines={4}
            helperText={copy.filePickingLater}
          />
          {status === 'DRAFT' ? (
            <View style={styles.workActions}>
              <Button label={copy.saveDraft} variant="secondary" loading={mutating} disabled={disabled} onPress={() => void saveDraft()} />
              <Button label={copy.submit} loading={mutating} disabled={disabled} onPress={() => void submit()} />
            </View>
          ) : null}
          {status === 'RETURNED' ? (
            <Button label={copy.resubmit} loading={mutating} disabled={disabled} onPress={() => void resubmit()} />
          ) : null}
        </View>
      ) : null}

      {revisions.length > 0 ? (
        <View style={styles.workBlock}>
          <UiText variant="label" tone="muted">{copy.revisions}</UiText>
          {revisions.map((revision) => (
            <UiText key={revision.id} variant="meta" tone="muted">
              {`#${revision.revisionNo} · ${revision.fileName ?? revision.textBody?.slice(0, 40) ?? ''}`}
            </UiText>
          ))}
        </View>
      ) : null}

      <View style={styles.workBlock}>
        <UiText variant="label" tone="muted">{copy.feedback}</UiText>
        {feedback.length === 0 ? (
          <UiText variant="meta" tone="muted">{copy.emptyFeedback}</UiText>
        ) : (
          feedback.map((row) => (
            <UiText key={row.id} variant="meta">
              {row.score != null ? `${row.score} · ` : ''}{row.comment ?? ''}
            </UiText>
          ))
        )}
      </View>

      <Button label="×" accessibilityLabel={copy.retry} variant="text" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  work: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  workForm: {
    gap: 8,
  },
  workActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  workBlock: {
    gap: 4,
  },
});
