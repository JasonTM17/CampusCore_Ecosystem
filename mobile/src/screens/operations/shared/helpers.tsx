import { Linking, View } from 'react-native';

import { Button, Card, ScreenShell, UiText } from '../../../components/Ui';
import { ApiClientError } from '../../../api/client';
import type { AttendanceStatus, LecturerScheduleEntry } from '../../../api/client';
import { useOpsStyles } from './styles';

export const PORTAL_URL = process.env.EXPO_PUBLIC_PORTAL_URL ?? 'https://portal.localhost:3102';
export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function lecturerErrorMessage(error: unknown, fallback: string) {
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

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function scheduleLine(entry: LecturerScheduleEntry): string {
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

export function lecturerName(course: { courseName?: string; courseNameEn?: string; courseNameVi?: string }): string {
  return course.courseName ?? course.courseNameVi ?? course.courseNameEn ?? 'Untitled course';
}

export function WebOnlyPanel({ title }: { title: string }) {
  const styles = useOpsStyles();
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
