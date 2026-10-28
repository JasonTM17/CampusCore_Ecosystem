import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import {
  Badge,
  Button,
  Card,
  DataNotice,
  Field,
  ProgressBar,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { apiClient, campusApi } from '../../api/client';
import type { StudentGradeRow } from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import type { MobileScreenProps } from '../../navigation/types';
import { lecturerErrorMessage, lecturerName } from './shared/helpers';
import { previewGrading, previewGrades } from './shared/preview';
import { useOpsStyles } from './shared/styles';

export function LecturerGradingScreen({ navigation }: MobileScreenProps) {
  const styles = useOpsStyles();
  const isPreview = apiClient.mode === 'preview';
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const sectionsQuery = useScreenQuery('lecturer:grading', () => campusApi.lecturerGradingSections(), {
    enabled: !isPreview,
    errorMessage: 'The grading queue is unavailable.',
    mapError: (error) => lecturerErrorMessage(error, 'The grading queue is unavailable.'),
  });
  const sections = isPreview ? previewGrading : sectionsQuery.data ?? [];
  const sectionId = (typeof params.sectionId === 'string' && params.sectionId) || sections[0]?.sectionId;
  const section = sections.find((item) => item.sectionId === sectionId);

  const gradesQuery = useScreenQuery(
    `lecturer:grades:${sectionId ?? 'none'}`,
    async () => (sectionId ? campusApi.sectionGrades(sectionId) : [] as StudentGradeRow[]),
    {
      enabled: !isPreview && Boolean(sectionId),
      errorMessage: 'Section grades are unavailable.',
      mapError: (error) => lecturerErrorMessage(error, 'Section grades are unavailable.'),
    },
  );

  const rows = useMemo(() => (isPreview ? previewGrades : gradesQuery.data ?? []), [isPreview, gradesQuery.data]);
  const [edits, setEdits] = useState<Record<string, { processScore?: string; finalExamScore?: string }>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'published' | 'error'>('idle');
  const [actionError, setActionError] = useState<string | null>(null);

  const editFor = (enrollmentId: string, field: 'processScore' | 'finalExamScore', current: number | null | undefined) =>
    edits[enrollmentId]?.[field] ?? (current == null ? '' : String(current));

  const parseScore = (value: string): number | null | undefined => {
    if (value.trim() === '') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10 ? parsed : undefined;
  };

  const save = async () => {
    if (!sectionId || isPreview) {
      setSaveState('saved');
      return;
    }
    const grades = rows.map((row) => {
      const processRaw = parseScore(editFor(row.enrollmentId, 'processScore', row.processScore));
      const finalRaw = parseScore(editFor(row.enrollmentId, 'finalExamScore', row.finalExamScore));
      return { enrollmentId: row.enrollmentId, processScore: processRaw, finalExamScore: finalRaw };
    });
    if (grades.some((grade) => grade.processScore === undefined || grade.finalExamScore === undefined)) {
      setActionError('Scores must be numbers between 0 and 10.');
      setSaveState('error');
      return;
    }
    setSaveState('saving');
    setActionError(null);
    try {
      await campusApi.saveSectionGrades(sectionId, grades);
      setEdits({});
      setSaveState('saved');
      void gradesQuery.reload();
      void sectionsQuery.reload();
    } catch (nextError) {
      setSaveState('error');
      setActionError(lecturerErrorMessage(nextError, 'Grades could not be saved.'));
    }
  };

  const publish = async () => {
    if (!sectionId || isPreview) {
      setPublishState('published');
      return;
    }
    setPublishState('publishing');
    setActionError(null);
    try {
      await campusApi.publishSectionGrades(sectionId);
      setPublishState('published');
      void gradesQuery.reload();
      void sectionsQuery.reload();
    } catch (nextError) {
      setPublishState('error');
      setActionError(lecturerErrorMessage(nextError, 'Grades could not be published.'));
    }
  };

  if (!isPreview && (sectionsQuery.isLoading || (sectionId && gradesQuery.isLoading))) {
    return (
      <ScreenShell title="Gradebook" eyebrow="Lecturer workspace">
        <StatePanel kind="loading" title="Loading gradebook…" description="Retrieving section enrollments." />
      </ScreenShell>
    );
  }
  const queryError = sectionsQuery.error ?? gradesQuery.error;
  if (!isPreview && queryError) {
    return (
      <ScreenShell title="Gradebook" eyebrow="Lecturer workspace">
        <StatePanel kind="error" title="Gradebook unavailable" description={queryError} actionLabel="Try again" onAction={() => { void sectionsQuery.reload(); void gradesQuery.reload(); }} />
      </ScreenShell>
    );
  }

  const graded = section ? section.gradedCount : rows.filter((row) => row.finalGrade != null).length;
  const total = section ? section.enrolledCount : rows.length;
  const progress = total > 0 ? Math.round((graded / total) * 100) : 0;

  return (
    <ScreenShell
      title="Gradebook"
      eyebrow={section ? `${section.courseCode ?? 'Section'} · ${lecturerName(section)}` : 'Lecturer workspace'}
      subtitle="Keep feedback clear before publishing."
    >
      {sectionsQuery.warning ?? gradesQuery.warning ? <DataNotice message={sectionsQuery.warning ?? gradesQuery.warning ?? ''} /> : null}
      <Card tone="primary" style={styles.gradingHero}>
        <View style={styles.courseHeader}>
          <View style={styles.topicCopy}>
            <UiText variant="bodySmall" tone="muted">Pending scores</UiText>
            <UiText variant="display" tone="primary">{Math.max(total - graded, 0)}</UiText>
          </View>
          <Badge label={section?.gradeStatus ?? 'DRAFT'} tone={section?.gradeStatus === 'PUBLISHED' ? 'success' : 'warning'} />
        </View>
        <ProgressBar label="Graded" value={progress} />
      </Card>
      <ScreenSpacer />
      <SectionHeading
        title="Students"
        actionLabel={sections.length > 1 ? 'Switch section' : undefined}
        onAction={sections.length > 1 ? () => {
          const nextIndex = (sections.findIndex((item) => item.sectionId === sectionId) + 1) % sections.length;
          navigation.navigate('lecturer.grading', { sectionId: sections[nextIndex].sectionId });
        } : undefined}
      />
      {rows.length === 0 ? (
        <StatePanel kind="empty" title="No enrollments" description="Enrolled students appear here once registration closes." />
      ) : (
        rows.map((row) => (
          <Card key={row.enrollmentId} style={styles.gradeRow}>
            <UiText variant="label">{row.studentName ?? row.studentCode ?? row.enrollmentId}</UiText>
            <View style={styles.scoreFields}>
              <Field
                label="Process"
                keyboardType="decimal-pad"
                onChangeText={(value) => setEdits((current) => ({ ...current, [row.enrollmentId]: { ...current[row.enrollmentId], processScore: value } }))}
                placeholder="0–10"
                style={styles.scoreField}
                value={editFor(row.enrollmentId, 'processScore', row.processScore)}
              />
              <Field
                label="Final exam"
                keyboardType="decimal-pad"
                onChangeText={(value) => setEdits((current) => ({ ...current, [row.enrollmentId]: { ...current[row.enrollmentId], finalExamScore: value } }))}
                placeholder="0–10"
                style={styles.scoreField}
                value={editFor(row.enrollmentId, 'finalExamScore', row.finalExamScore)}
              />
            </View>
          </Card>
        ))
      )}
      <ScreenSpacer />
      {actionError ? (
        <View accessibilityLiveRegion="assertive" style={styles.actionStatusError}>
          <UiText variant="bodySmall" tone="error">{actionError}</UiText>
        </View>
      ) : null}
      {saveState === 'saved' || publishState === 'published' ? (
        <View accessibilityLiveRegion="polite" style={styles.actionStatus}>
          <UiText variant="bodySmall" tone="success">
            {publishState === 'published' ? 'Grades published.' : 'Draft scores saved.'}
          </UiText>
        </View>
      ) : null}
      <Button
        label={isPreview ? 'Save scores (preview)' : 'Save scores'}
        loading={saveState === 'saving'}
        disabled={rows.length === 0}
        onPress={() => void save()}
      />
      <Button
        label="Publish grades"
        variant="secondary"
        loading={publishState === 'publishing'}
        disabled={rows.length === 0 || (section ? !section.canPublish : true)}
        onPress={() => void publish()}
        style={styles.secondaryButton}
      />
    </ScreenShell>
  );
}
