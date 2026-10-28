import { useMemo } from 'react';
import { View } from 'react-native';

import {
  Badge,
  Card,
  Divider,
  ListRow,
  MetricCard,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { LaneEntries } from '../lanes/LaneEntries';
import { lecturerApi } from './lecturer-api';
import { courseTitle, dayNumberOf, normalizeDay } from './lecturer-model';
import { HandoffButton, OpsShell, isOpsPreview, sectionLabel, slotText, useOpsQuery } from './lecturer-ui';
import { useOpsCopy } from './shared/helpers';
import { previewGrading, previewSchedule } from './shared/preview';
import { useOpsStyles } from './shared/styles';

export function LecturerDashboardScreen({ navigation }: MobileScreenProps) {
  const styles = useOpsStyles();
  const { copy, locale } = useOpsCopy();
  const preview = isOpsPreview();
  const schedule = useOpsQuery('lecturer:schedule', () => lecturerApi.schedule(), copy);
  const grading = useOpsQuery('lecturer:grading', () => lecturerApi.gradingSections(), copy);

  const sections = useMemo(() => (preview ? previewSchedule : schedule.data ?? []), [preview, schedule.data]);
  const gradingSections = useMemo(() => (preview ? previewGrading : grading.data ?? []), [preview, grading.data]);

  const pending = gradingSections.reduce((total, section) => total + Math.max(section.enrolledCount - section.gradedCount, 0), 0);
  const students = sections.reduce((total, section) => total + (section.enrolledCount ?? 0), 0);

  const today = dayNumberOf(new Date());
  const todayClasses = sections
    .flatMap((section) => (section.schedules ?? []).filter((slot) => normalizeDay(slot.dayOfWeek) === today).map((slot) => ({ section, slot })))
    .sort((left, right) => left.slot.startTime.localeCompare(right.slot.startTime));

  const loading = !preview && (schedule.isLoading || grading.isLoading);
  const error = preview ? null : schedule.error ?? grading.error;
  const warning = preview ? null : schedule.warning ?? grading.warning;

  return (
    <OpsShell
      title={copy.dashboardTitle}
      loading={loading}
      error={error}
      warning={warning}
      onRetry={() => { void schedule.reload(); void grading.reload(); }}
    >
      {sections.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptyDashboard} />
      ) : (
        <View>
          <View style={styles.metrics}>
            <MetricCard label={copy.metricSections} value={String(sections.length)} style={styles.metric} />
            <MetricCard label={copy.metricStudents} value={String(students)} style={styles.metric} />
            <MetricCard label={copy.metricToGrade} value={String(pending)} style={styles.metric} />
          </View>
          <SectionHeading title={copy.todayTitle} />
          {todayClasses.length === 0 ? (
            <UiText variant="bodySmall" tone="muted">{copy.noClassToday}</UiText>
          ) : (
            <Card>
              {todayClasses.map(({ section, slot }, index) => (
                <View key={`${section.sectionId}-${slot.id ?? index}`}>
                  {index > 0 ? <Divider /> : null}
                  <ListRow
                    title={courseTitle(section, locale) || sectionLabel(section, copy, locale)}
                    subtitle={slotText(slot, copy)}
                    meta={section.courseCode}
                  />
                </View>
              ))}
            </Card>
          )}
          <ScreenSpacer />
        </View>
      )}
      <SectionHeading title={copy.shortcutsTitle} />
      <Card>
        <ListRow
          title={copy.scheduleTitle}
          subtitle={fillCopy(copy.studentsCount, { n: students })}
          onPress={() => navigation.navigate('lecturer.schedule')}
          trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
        <Divider />
        <ListRow
          title={copy.gradingTitle}
          subtitle={pending > 0 ? fillCopy(copy.scoresPending, { n: pending }) : copy.allCaughtUp}
          onPress={() => navigation.navigate('lecturer.grading')}
          trailing={pending > 0 ? <Badge label={String(pending)} tone="warning" /> : <UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
        <Divider />
        <ListRow
          title={copy.attendanceTitle}
          onPress={() => navigation.navigate('lecturer.attendance')}
          trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
      </Card>
      <ScreenSpacer />
      <LaneEntries groups={['dean', 'staff']} navigation={navigation} />
      <SectionHeading title={copy.handoffTitle} />
      <HandoffButton label={copy.mailTitle} path="/dashboard/lecturer/mail" />
      <HandoffButton label={copy.importTitle} path="/dashboard/lecturer/grades" />
      <HandoffButton label={copy.printTitle} path="/dashboard/lecturer/grades" />
    </OpsShell>
  );
}
