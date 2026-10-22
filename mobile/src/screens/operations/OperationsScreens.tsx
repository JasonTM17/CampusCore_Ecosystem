import { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import {
  Badge,
  Button,
  Card,
  DataNotice,
  Divider,
  Field,
  ListRow,
  MetricCard,
  ProgressBar,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import {
  apiClient,
  campusApi,
  type AttendanceRecord,
  type AttendanceRosterEntry,
  type AttendanceStatus,
  type LecturerGradingSection,
  type LecturerScheduleEntry,
  type StudentGradeRow,
} from '../../api/client';
import { ApiClientError } from '../../api/client';
import { tokens } from '../../design/tokens';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import type { MobileScreenProps } from '../../navigation/types';

const PORTAL_URL = process.env.EXPO_PUBLIC_PORTAL_URL ?? 'https://portal.localhost:3102';
const ATTENDANCE_STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function lecturerErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) {
    if (error.status === 403) {
      return 'You do not have access to this academic record.';
    }
    if (error.status === 0) {
      return 'You appear to be offline — showing the last known data.';
    }
  }
  return fallback;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function scheduleLine(entry: LecturerScheduleEntry): string {
  const slot = entry.schedules?.[0];
  if (!slot) {
    return 'Schedule pending';
  }
  const day = DAY_LABELS[(slot.dayOfWeek ?? 1) - 1] ?? `Day ${slot.dayOfWeek}`;
  const room = slot.classroom
    ? `${slot.classroom.building ?? ''}${slot.classroom.roomNumber ? ` ${slot.classroom.roomNumber}` : ''}`
    : 'Room pending';
  return `${day} · ${slot.startTime} – ${slot.endTime} · ${room}`;
}

/**
 * Web-only surface (mobile-policy §4): admin has no native lane — static
 * fixtures are replaced by an honest unavailable state with a portal link.
 */
function WebOnlyPanel({ title }: { title: string }) {
  return (
    <ScreenShell title={title} eyebrow="Web portal" subtitle="This workspace is managed on the web.">
      <Card tone="primary" style={styles.webOnlyCard}>
        <UiText variant="headlineSmall">{title} lives on the portal</UiText>
        <UiText variant="bodySmall" tone="muted" style={styles.webOnlyCopy}>
          Administration stays on the web portal so they keep the full
          audit and accessibility surface. Sign in there with the same account.
        </UiText>
        <Button
          label="Open web portal"
          onPress={() => void Linking.openURL(PORTAL_URL).catch(() => undefined)}
          style={styles.submit}
        />
      </Card>
    </ScreenShell>
  );
}

export function AdminDashboardScreen() {
  return <WebOnlyPanel title="Admin dashboard" />;
}

export function AdminStudentsScreen() {
  return <WebOnlyPanel title="Manage students" />;
}

export function AdminLecturersScreen() {
  return <WebOnlyPanel title="Manage lecturers" />;
}

const previewSchedule: LecturerScheduleEntry[] = [
  {
    sectionId: 'preview-cs204',
    sectionNumber: '02',
    courseCode: 'CS204',
    courseName: 'Software Architecture',
    enrolledCount: 16,
    schedules: [{ dayOfWeek: 2, startTime: '08:00', endTime: '09:30', classroom: { building: 'A2', roomNumber: '204' } }],
  },
  {
    sectionId: 'preview-ba312',
    sectionNumber: '01',
    courseCode: 'BA312',
    courseName: 'Business Analytics',
    enrolledCount: 18,
    schedules: [{ dayOfWeek: 2, startTime: '13:30', endTime: '15:00', classroom: { building: 'B1', roomNumber: '108' } }],
  },
];

const previewGrading: LecturerGradingSection[] = [
  { sectionId: 'preview-cs204', courseCode: 'CS204', courseName: 'Software Architecture', enrolledCount: 16, gradedCount: 10, publishedCount: 0, canPublish: true, gradeStatus: 'DRAFT' },
  { sectionId: 'preview-ba312', courseCode: 'BA312', courseName: 'Business Analytics', enrolledCount: 18, gradedCount: 18, publishedCount: 18, canPublish: false, gradeStatus: 'PUBLISHED' },
];

const previewRoster: AttendanceRosterEntry[] = [
  { studentId: 'st-1', studentCode: '2022SE0417', firstName: 'Duc Minh', lastName: 'Nguyen' },
  { studentId: 'st-2', studentCode: '2023BA0192', firstName: 'Anh Thu', lastName: 'Pham' },
  { studentId: 'st-3', studentCode: '2024IT0871', firstName: 'Khanh Vy', lastName: 'Le' },
];

const previewGrades: StudentGradeRow[] = [
  { enrollmentId: 'enr-1', studentCode: '2022SE0417', studentName: 'Nguyen Duc Minh', processScore: 8.5, finalExamScore: 9.1, gradeStatus: 'DRAFT' },
  { enrollmentId: 'enr-2', studentCode: '2023BA0192', studentName: 'Pham Anh Thu', processScore: 8.0, finalExamScore: 8.6, gradeStatus: 'DRAFT' },
  { enrollmentId: 'enr-3', studentCode: '2024IT0871', studentName: 'Le Khanh Vy', processScore: null, finalExamScore: null, gradeStatus: 'DRAFT' },
];

function lecturerName(course: { courseName?: string; courseNameEn?: string; courseNameVi?: string }): string {
  return course.courseName ?? course.courseNameVi ?? course.courseNameEn ?? 'Untitled course';
}

export function LecturerDashboardScreen({ navigation }: MobileScreenProps) {
  const isPreview = apiClient.mode === 'preview';
  const schedule = useScreenQuery('lecturer:schedule', () => campusApi.lecturerSchedule(), {
    enabled: !isPreview,
    errorMessage: 'Teaching schedule is unavailable.',
    mapError: (error) => lecturerErrorMessage(error, 'Teaching schedule is unavailable.'),
  });
  const grading = useScreenQuery('lecturer:grading', () => campusApi.lecturerGradingSections(), {
    enabled: !isPreview,
    errorMessage: 'Grading queue is unavailable.',
    mapError: (error) => lecturerErrorMessage(error, 'Grading queue is unavailable.'),
  });

  const sections = isPreview ? previewSchedule : schedule.data ?? [];
  const gradingSections = isPreview ? previewGrading : grading.data ?? [];
  const pending = gradingSections.reduce(
    (total, section) => total + Math.max(section.enrolledCount - section.gradedCount, 0),
    0,
  );
  const isLoading = schedule.isLoading || grading.isLoading;
  const error = schedule.error ?? grading.error;

  if (isLoading || error) {
    return (
      <ScreenShell title="Lecturer dashboard" eyebrow="Lecturer workspace">
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? 'Loading teaching day…' : 'Dashboard unavailable'}
          description={error ?? 'Retrieving your sections.'}
          actionLabel={error ? 'Try again' : undefined}
          onAction={error ? () => { void schedule.reload(); void grading.reload(); } : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Lecturer dashboard" eyebrow="Lecturer workspace" subtitle="Your teaching day, kept readable.">
      {schedule.warning ?? grading.warning ? <DataNotice message={schedule.warning ?? grading.warning ?? ''} /> : null}
      <Card tone="primary" style={styles.hero}>
        <UiText variant="meta" tone="primary">LECTURER WORKSPACE</UiText>
        <UiText variant="headlineSmall" style={styles.heroTitle}>
          {sections.length === 0 ? 'No sections assigned yet.' : `${sections.length} section${sections.length === 1 ? '' : 's'} on your roster.`}
        </UiText>
        <UiText variant="bodySmall" tone="muted">Attendance and grading actions are one tap away.</UiText>
      </Card>
      <ScreenSpacer />
      <View style={styles.metricGrid}>
        <MetricCard label="Sections" value={String(sections.length)} detail="Assigned to you" style={styles.metricLeft} />
        <MetricCard label="To grade" value={String(pending)} detail="Pending scores" />
      </View>
      <ScreenSpacer />
      <SectionHeading title="Teaching shortcuts" />
      <Card>
        <ListRow leading="◷" title="Teaching schedule" subtitle={sections[0] ? `Next · ${scheduleLine(sections[0])}` : 'No classes scheduled'} onPress={() => navigation.navigate('lecturer.schedule')} trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>} />
        <Divider />
        <ListRow leading="G" title="Gradebook" subtitle={pending > 0 ? `${pending} scores pending` : 'All caught up'} onPress={() => navigation.navigate('lecturer.grading')} trailing={pending > 0 ? <Badge label={String(pending)} tone="warning" /> : <UiText variant="bodyMedium" tone="muted">›</UiText>} />
        <Divider />
        <ListRow leading="P" title="Class attendance" subtitle="Mark today’s attendance" onPress={() => navigation.navigate('lecturer.attendance')} trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>} />
      </Card>
    </ScreenShell>
  );
}

export function LecturerScheduleScreen({ navigation }: MobileScreenProps) {
  const isPreview = apiClient.mode === 'preview';
  const query = useScreenQuery('lecturer:schedule', () => campusApi.lecturerSchedule(), {
    enabled: !isPreview,
    errorMessage: 'Teaching schedule is unavailable.',
    mapError: (error) => lecturerErrorMessage(error, 'Teaching schedule is unavailable.'),
  });
  const sections = isPreview ? previewSchedule : query.data ?? [];

  if (query.isLoading || query.error) {
    return (
      <ScreenShell title="Teaching schedule" eyebrow="Lecturer workspace">
        <StatePanel
          kind={query.isLoading ? 'loading' : 'error'}
          title={query.isLoading ? 'Loading schedule…' : 'Schedule unavailable'}
          description={query.error ?? 'Retrieving your sections.'}
          actionLabel={query.error ? 'Try again' : undefined}
          onAction={query.error ? () => void query.reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Teaching schedule" eyebrow="Lecturer workspace" subtitle="Your sections and the next handoff.">
      {query.warning ? <DataNotice message={query.warning} /> : null}
      {sections.length === 0 ? (
        <StatePanel kind="empty" title="No sections" description="Sections appear after the academic office assigns your teaching load." />
      ) : null}
      {sections.map((item) => (
        <Card key={item.sectionId} style={styles.scheduleCard}>
          <View style={styles.scheduleHeader}>
            <View style={styles.topicCopy}>
              <UiText variant="meta" tone="primary">{item.courseCode ?? item.sectionNumber ?? item.sectionId}</UiText>
              <UiText variant="headlineSmall">{lecturerName(item)}</UiText>
              <UiText variant="bodySmall" tone="muted">{scheduleLine(item)}</UiText>
            </View>
            <Badge label={`${item.enrolledCount ?? 0} students`} tone="neutral" />
          </View>
          <Button
            label="Take attendance"
            onPress={() => navigation.navigate('lecturer.attendance', { sectionId: item.sectionId })}
            variant="secondary"
            style={styles.topButton}
          />
        </Card>
      ))}
      <Button label="Open gradebook" onPress={() => navigation.navigate('lecturer.grading')} variant="secondary" />
    </ScreenShell>
  );
}

export function LecturerAttendanceScreen({ navigation }: MobileScreenProps) {
  const isPreview = apiClient.mode === 'preview';
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const sectionsQuery = useScreenQuery('lecturer:schedule', () => campusApi.lecturerSchedule(), {
    enabled: !isPreview,
    errorMessage: 'Sections are unavailable.',
    mapError: (error) => lecturerErrorMessage(error, 'Sections are unavailable.'),
  });
  const sections = isPreview ? previewSchedule : sectionsQuery.data ?? [];
  const sectionId = (typeof params.sectionId === 'string' && params.sectionId) || sections[0]?.sectionId;
  const section = sections.find((item) => item.sectionId === sectionId);

  const rosterQuery = useScreenQuery(
    `lecturer:roster:${sectionId ?? 'none'}`,
    async () => {
      if (!sectionId) {
        return [] as AttendanceRosterEntry[];
      }
      const [roster, marks] = await Promise.all([
        campusApi.attendanceRoster(sectionId),
        // 404 = no sheet for today yet (legitimately empty). Any other
        // failure must surface — silently defaulting every mark to PRESENT
        // would let a save overwrite real data (review F5).
        campusApi.sectionAttendance(sectionId, todayIso()).catch((error: unknown) => {
          if ((error as { status?: number })?.status === 404) {
            return [] as AttendanceRecord[];
          }
          throw error;
        }),
      ]);
      const markByStudent = new Map(marks.map((mark) => [mark.studentId, mark.status]));
      return roster.map((entry) => ({
        ...entry,
        _status: (markByStudent.get(entry.studentId) as AttendanceStatus | undefined) ?? 'PRESENT',
      }));
    },
    {
      enabled: !isPreview && Boolean(sectionId),
      errorMessage: 'The class roster is unavailable.',
      mapError: (error) => lecturerErrorMessage(error, 'The class roster is unavailable.'),
    },
  );

  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const roster = isPreview ? previewRoster : rosterQuery.data ?? [];
  const statusFor = (studentId: string): AttendanceStatus =>
    marks[studentId]
      ?? (roster.find((entry) => entry.studentId === studentId) as { _status?: AttendanceStatus } | undefined)?._status
      ?? 'PRESENT';

  const cycleStatus = (studentId: string) => {
    const current = statusFor(studentId);
    const next = ATTENDANCE_STATUSES[(ATTENDANCE_STATUSES.indexOf(current) + 1) % ATTENDANCE_STATUSES.length];
    setMarks((currentMarks) => ({ ...currentMarks, [studentId]: next }));
    setSaveState('idle');
  };

  const save = async () => {
    if (!sectionId || isPreview) {
      setSaveState('saved');
      return;
    }
    setSaveState('saving');
    setSaveError(null);
    try {
      await campusApi.saveSectionAttendance(
        sectionId,
        todayIso(),
        roster.map((entry) => ({ studentId: entry.studentId, status: statusFor(entry.studentId) })),
      );
      setSaveState('saved');
      void rosterQuery.reload();
    } catch (nextError) {
      setSaveState('error');
      setSaveError(lecturerErrorMessage(nextError, 'Attendance could not be saved.'));
    }
  };

  if (!isPreview && (sectionsQuery.isLoading || (sectionId && rosterQuery.isLoading))) {
    return (
      <ScreenShell title="Class attendance" eyebrow="Lecturer workspace">
        <StatePanel kind="loading" title="Loading roster…" description="Retrieving enrolled students." />
      </ScreenShell>
    );
  }
  const queryError = sectionsQuery.error ?? rosterQuery.error;
  if (!isPreview && queryError) {
    return (
      <ScreenShell title="Class attendance" eyebrow="Lecturer workspace">
        <StatePanel kind="error" title="Attendance unavailable" description={queryError} actionLabel="Try again" onAction={() => { void sectionsQuery.reload(); void rosterQuery.reload(); }} />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      title="Class attendance"
      eyebrow={section ? `${section.courseCode ?? 'Section'} · Today` : 'Lecturer workspace'}
      subtitle={section ? `${lecturerName(section)} · ${scheduleLine(section)}` : 'Mark attendance with a readable, focused list.'}
    >
      {sectionsQuery.warning ?? rosterQuery.warning ? <DataNotice message={sectionsQuery.warning ?? rosterQuery.warning ?? ''} /> : null}
      {roster.length === 0 ? (
        <StatePanel kind="empty" title="No enrolled students" description="The roster appears once enrollments are confirmed for this section." />
      ) : (
        <Card>
          {roster.map((student, index, list) => (
            <View key={student.studentId}>
              <ListRow
                leading={(student.firstName ?? student.studentCode ?? '?').slice(0, 1)}
                title={`${student.lastName ?? ''} ${student.firstName ?? ''}`.trim() || student.studentCode || student.studentId}
                subtitle={student.studentCode ?? student.studentId}
                trailing={
                  <Button
                    label={statusFor(student.studentId)}
                    variant={statusFor(student.studentId) === 'PRESENT' ? 'secondary' : 'text'}
                    onPress={() => cycleStatus(student.studentId)}
                  />
                }
              />
              {index < list.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Card>
      )}
      <ScreenSpacer />
      {saveError ? (
        <View accessibilityLiveRegion="assertive" style={styles.actionStatusError}>
          <UiText variant="bodySmall" tone="error">{saveError}</UiText>
        </View>
      ) : null}
      {saveState === 'saved' ? (
        <View accessibilityLiveRegion="polite" style={styles.actionStatus}>
          <UiText variant="bodySmall" tone="success">Attendance saved.</UiText>
        </View>
      ) : null}
      <Button
        label={isPreview ? 'Save attendance (preview)' : 'Save attendance'}
        loading={saveState === 'saving'}
        disabled={roster.length === 0}
        onPress={() => void save()}
      />
      {sections.length > 1 ? (
        <Button
          label="Switch section"
          variant="secondary"
          style={styles.secondaryButton}
          onPress={() => {
            const nextIndex = (sections.findIndex((item) => item.sectionId === sectionId) + 1) % sections.length;
            navigation.navigate('lecturer.attendance', { sectionId: sections[nextIndex].sectionId });
          }}
        />
      ) : null}
    </ScreenShell>
  );
}

export function LecturerGradingScreen({ navigation }: MobileScreenProps) {
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

const styles = StyleSheet.create({
  webOnlyCard: { gap: tokens.spacing.sm, padding: tokens.spacing.lg },
  webOnlyCopy: { marginBottom: tokens.spacing.sm },
  submit: { marginTop: tokens.spacing.sm },
  hero: { padding: tokens.spacing.lg },
  heroTitle: { marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.sm },
  metricGrid: { flexDirection: 'row' },
  metricLeft: { marginRight: tokens.spacing.sm },
  scheduleCard: { marginBottom: tokens.spacing.sm, padding: tokens.spacing.md },
  scheduleHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  topicCopy: { flex: 1, paddingRight: tokens.spacing.sm },
  gradingHero: { padding: tokens.spacing.lg },
  courseHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  gradeRow: { marginBottom: tokens.spacing.sm, padding: tokens.spacing.md },
  scoreFields: { flexDirection: 'row', gap: tokens.spacing.sm, marginTop: tokens.spacing.sm },
  scoreField: { flex: 1 },
  secondaryButton: { marginTop: tokens.spacing.sm },
  topButton: { marginTop: tokens.spacing.sm },
  actionStatus: { backgroundColor: '#EDF8F1', borderColor: '#B8DEC7', borderLeftColor: tokens.colors.success, borderLeftWidth: 3, borderRadius: tokens.radii.control, borderWidth: 1, marginBottom: tokens.spacing.sm, padding: tokens.spacing.sm },
  actionStatusError: { backgroundColor: '#FFF1F0', borderColor: '#F3C7C3', borderLeftColor: tokens.colors.error, borderLeftWidth: 3, borderRadius: tokens.radii.control, borderWidth: 1, marginBottom: tokens.spacing.sm, padding: tokens.spacing.sm },
});
