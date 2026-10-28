import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import {
  Button,
  Card,
  DataNotice,
  Divider,
  ListRow,
  ScreenShell,
  ScreenSpacer,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { apiClient, campusApi } from '../../api/client';
import type { AttendanceRecord, AttendanceRosterEntry, AttendanceStatus } from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import type { MobileScreenProps } from '../../navigation/types';
import { lecturerErrorMessage, todayIso, scheduleLine, lecturerName, ATTENDANCE_STATUSES } from './shared/helpers';
import { previewSchedule, previewRoster } from './shared/preview';
import { useOpsStyles } from './shared/styles';

export function LecturerAttendanceScreen({ navigation }: MobileScreenProps) {
  const styles = useOpsStyles();
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
