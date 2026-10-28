import { useState } from 'react';
import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  DataNotice,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { apiClient, campusApi, type MobileEnrollment } from '../../api/client';
import type { MobileScreenProps } from '../../navigation/types';
import { useLiveResource } from './shared/useLiveResource';
import { upcomingClasses } from './shared/preview';
import { useStudentStyles } from './shared/styles';

export function ScheduleScreen({ navigation }: MobileScreenProps) {
  const styles = useStudentStyles();
  const [weekOffset, setWeekOffset] = useState(0);
  const {
    data: liveEnrollments,
    error,
    warning,
    isLoading,
    reload,
  } = useLiveResource<MobileEnrollment[]>(
    'enrollments',
    [],
    () => campusApi.enrollments(),
    'Schedule is unavailable.',
  );
  const liveSchedule = liveEnrollments.flatMap((item) => (item.section?.schedules ?? []).map((slot) => ({
    code: item.section?.course?.code ?? item.section?.sectionNumber ?? item.sectionId,
    name: item.section?.course?.nameVi ?? item.section?.course?.name ?? 'Course',
    time: `${slot.startTime} – ${slot.endTime}`,
    room: slot.classroom ? `${slot.classroom.building ?? ''} ${slot.classroom.roomNumber ?? ''}`.trim() : 'TBA',
    day: slot.dayOfWeek,
  })));
  const visibleSchedule = apiClient.mode === 'preview'
    ? upcomingClasses.map((item) => ({ ...item, day: 2 }))
    : liveSchedule;
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset + weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
  const weekEnd = weekDays[6];
  const dateFormatter = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' });
  const weekLabel = `${dateFormatter.format(weekStart)} - ${dateFormatter.format(weekEnd)}`;

  if (isLoading || error) {
    return (
      <ScreenShell title="Schedule" eyebrow="Current semester" subtitle="Your published class sessions.">
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? 'Loading schedule…' : 'Schedule unavailable'}
          description={error ?? 'Retrieving your published class sessions.'}
          actionLabel={error ? 'Try again' : undefined}
          onAction={error ? () => void reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Schedule" eyebrow="Current semester" subtitle="Your published class sessions.">
      {warning ? <DataNotice message={warning} /> : null}
      <Card tone="low" style={styles.weekCard}>
        <View style={styles.weekHeader}>
          <Button accessibilityLabel="Previous week" label="‹" onPress={() => setWeekOffset((current) => current - 1)} variant="text" />
          <View style={styles.weekTitle}>
            <UiText variant="label">{weekLabel}</UiText>
            <UiText variant="bodySmall" tone="muted">{weekOffset === 0 ? 'Current week' : weekOffset > 0 ? `${weekOffset} week ahead` : `${Math.abs(weekOffset)} week back`}</UiText>
          </View>
          <Button accessibilityLabel="Next week" label="›" onPress={() => setWeekOffset((current) => current + 1)} variant="text" />
        </View>
        <View style={styles.dayRow}>
          {weekDays.map((date, index) => {
            const active = weekOffset === 0 && date.toDateString() === today.toDateString();
            return (
            <View key={date.toISOString()} style={[styles.dayCell, active ? styles.dayCellActive : undefined]}>
              <UiText variant="meta" tone={active ? 'onPrimary' : 'muted'}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</UiText>
              <UiText variant="label" tone={active ? 'onPrimary' : 'default'}>{date.getDate()}</UiText>
            </View>
            );
          })}
        </View>
      </Card>

      <ScreenSpacer />
      <SectionHeading title="Weekly sessions" actionLabel="Courses" onAction={() => navigation.navigate('courses')} />
      {visibleSchedule.map((item, index) => (
        <Card key={`${item.code}-${item.time}-${index}`} style={styles.scheduleCard}>
          <View style={styles.scheduleTime}>
            <UiText variant="label" tone="primary">{item.time.split(' – ')[0]}</UiText>
            <UiText variant="meta" tone="muted">90 min</UiText>
          </View>
          <View style={styles.scheduleInfo}>
            <UiText variant="label">{item.code} · {item.name}</UiText>
            <UiText variant="bodySmall" tone="muted">Day {item.day} · Room {item.room}</UiText>
          </View>
          <Badge label="On campus" tone="primary" />
        </Card>
      ))}
      {visibleSchedule.length === 0 ? <StatePanel kind="empty" title="No published sessions" description="Your timetable will appear after sections publish their schedules." /> : null}
      <Card tone="low" style={styles.noteCard}>
        <UiText variant="bodySmall" tone="muted">No classes after 15:00. Use the quiet afternoon for your thesis milestone.</UiText>
      </Card>
    </ScreenShell>
  );
}
