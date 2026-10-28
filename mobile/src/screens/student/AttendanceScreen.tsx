import { View } from 'react-native';

import {
  Card,
  DataNotice,
  ProgressBar,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { apiClient, campusApi, type MobileAttendanceSummary } from '../../api/client';
import type { MobileScreenProps } from '../../navigation/types';
import { useLiveResource } from './shared/useLiveResource';
import { useStudentStyles } from './shared/styles';

export function AttendanceScreen({ navigation }: MobileScreenProps) {
  const styles = useStudentStyles();
  const {
    data: liveAttendance,
    error,
    warning,
    isLoading,
    reload,
  } = useLiveResource<MobileAttendanceSummary[]>(
    'attendanceSummary',
    [],
    () => campusApi.attendanceSummary(),
    'Attendance is unavailable.',
  );
  const previewAttendance = [
    { sectionId: 'preview-cs204', courseCode: 'CS204', courseName: 'Software Architecture', total: 16, present: 15, absent: 1, late: 0, excused: 0, attendanceRate: 94 },
    { sectionId: 'preview-ba312', courseCode: 'BA312', courseName: 'Business Analytics', total: 15, present: 14, absent: 1, late: 0, excused: 0, attendanceRate: 93 },
  ];
  const visibleAttendance = apiClient.mode === 'preview' ? previewAttendance : liveAttendance;
  const overallAttendance = visibleAttendance.length > 0
    ? Math.round(visibleAttendance.reduce((sum, item) => sum + item.attendanceRate, 0) / visibleAttendance.length)
    : 0;

  if (isLoading || error) {
    return (
      <ScreenShell title="Attendance" eyebrow="Current semester" subtitle="Your published attendance summary.">
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? 'Loading attendance…' : 'Attendance unavailable'}
          description={error ?? 'Retrieving your attendance records.'}
          actionLabel={error ? 'Try again' : undefined}
          onAction={error ? () => void reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Attendance" eyebrow="Spring 2026" subtitle="Stay ahead of participation thresholds.">
      {warning ? <DataNotice message={warning} /> : null}
      <Card tone="primary" style={styles.attendanceHero}>
        <UiText variant="bodySmall" tone="muted">Overall attendance</UiText>
        <UiText variant="display" tone="primary">{overallAttendance}%</UiText>
        <ProgressBar label="Across active courses" value={overallAttendance} tone="success" />
      </Card>
      <ScreenSpacer />
      <SectionHeading title="By course" actionLabel="Schedule" onAction={() => navigation.navigate('schedule')} />
      {visibleAttendance.map((course) => (
        <Card key={course.sectionId} style={styles.attendanceCard}>
          <View style={styles.courseHeader}>
            <View style={styles.courseCopy}>
              <UiText variant="label">{course.courseCode}</UiText>
              <UiText variant="bodySmall" tone="muted">{course.courseName}</UiText>
            </View>
            <UiText variant="headlineSmall" tone="success">{course.attendanceRate}%</UiText>
          </View>
          <ProgressBar value={course.attendanceRate} label={`${course.present} of ${course.total} records present`} tone="success" />
        </Card>
      ))}
      {visibleAttendance.length === 0 ? <StatePanel kind="empty" title="No attendance records" description="Attendance summaries will appear after your lecturer publishes them." /> : null}
    </ScreenShell>
  );
}
