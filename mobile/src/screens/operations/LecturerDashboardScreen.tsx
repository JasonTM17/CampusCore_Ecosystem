import { useMemo } from 'react';
import { View } from 'react-native';

import {
  Button,
  Divider,
  HeroCard,
  ListRow,
  ScreenSpacer,
  SectionCard,
  SectionHeading,
  StatStrip,
  StatePanel,
  StatusPill,
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

  const heroTitle = todayClasses.length > 0
    ? fillCopy(copy.todayClassesCount, { n: todayClasses.length })
    : copy.noClassToday;
  const heroDetail = todayClasses.length > 0
    ? fillCopy(copy.todayClassesDetail, { count: todayClasses.length, students })
    : fillCopy(copy.studentsCount, { n: students });

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
          <HeroCard
            icon="school-outline"
            eyebrow={copy.todayTitle}
            title={heroTitle}
            detail={heroDetail}
          >
            <Button
              icon="calendar-clock-outline"
              label={copy.scheduleTitle}
              onPress={() => navigation.navigate('lecturer.schedule')}
              variant="secondary"
              onBrand
            />
          </HeroCard>

          <StatStrip
            style={styles.stats}
            items={[
              { icon: 'book-open-page-variant-outline', label: copy.metricSections, value: String(sections.length) },
              { icon: 'account-group-outline', label: copy.metricStudents, value: String(students) },
              { icon: 'clipboard-edit-outline', label: copy.metricToGrade, value: String(pending) },
            ]}
          />

          <ScreenSpacer />
          <SectionCard
            icon="calendar-clock-outline"
            title={copy.todayTitle}
            count={todayClasses.length > 0 ? String(todayClasses.length) : undefined}
            actionLabel={copy.scheduleTitle}
            onAction={() => navigation.navigate('lecturer.schedule')}
          >
            {todayClasses.length === 0 ? (
              <UiText variant="bodySmall" tone="muted" style={{ paddingVertical: 12 }}>
                {copy.noClassToday}
              </UiText>
            ) : (
              todayClasses.map(({ section, slot }, index) => (
                <View key={`${section.sectionId}-${slot.id ?? index}`}>
                  {index > 0 ? <Divider /> : null}
                  <ListRow
                    icon="book-open-outline"
                    title={courseTitle(section, locale) || sectionLabel(section, copy, locale)}
                    subtitle={slotText(slot, copy)}
                    trailing={<StatusPill label={section.courseCode ?? section.sectionId} tone="primary" />}
                    stackedMeta
                  />
                </View>
              ))
            )}
          </SectionCard>
          <ScreenSpacer />
        </View>
      )}

      <SectionCard icon="briefcase-outline" title={copy.shortcutsTitle}>
        <ListRow
          icon="calendar-month-outline"
          title={copy.scheduleTitle}
          subtitle={fillCopy(copy.studentsCount, { n: students })}
          onPress={() => navigation.navigate('lecturer.schedule')}
          trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
        <Divider />
        <ListRow
          icon="file-document-edit-outline"
          title={copy.gradingTitle}
          subtitle={pending > 0 ? fillCopy(copy.scoresPending, { n: pending }) : copy.allCaughtUp}
          onPress={() => navigation.navigate('lecturer.grading')}
          trailing={pending > 0 ? <StatusPill label={String(pending)} tone="warning" /> : <UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
        <Divider />
        <ListRow
          icon="account-check-outline"
          title={copy.attendanceTitle}
          onPress={() => navigation.navigate('lecturer.attendance')}
          trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
      </SectionCard>

      <ScreenSpacer />
      <LaneEntries groups={['dean', 'staff']} navigation={navigation} />
      <SectionHeading title={copy.handoffTitle} />
      <HandoffButton label={copy.mailTitle} path="/dashboard/lecturer/mail" />
      <HandoffButton label={copy.importTitle} path="/dashboard/lecturer/grades" />
      <HandoffButton label={copy.printTitle} path="/dashboard/lecturer/grades" />
    </OpsShell>
  );
}
