import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { campusApi } from '../../api/client';
import {
  Button,
  Divider,
  HeroCard,
  ListRow,
  ProgressBar,
  ScreenSpacer,
  SectionCard,
  SectionHeading,
  StatStrip,
  StatePanel,
  StatusPill,
  UiText,
} from '../../components/Ui';
import { fillCopy } from '../../i18n/academic-messages';
import { countForm } from '../../i18n/locale';
import { useLocale } from '../../i18n/locale-provider';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import type { MobileScreenProps } from '../../navigation/types';
import { LaneEntries } from '../lanes/LaneEntries';
import { lecturerApi } from './lecturer-api';
import {
  courseTitle,
  dashboardMetrics,
  dayNumberOf,
  departmentTitle,
  gradedPercent,
  normalizeDay,
  termTitle,
} from './lecturer-model';
import {
  HandoffButton,
  OpsShell,
  isOpsPreview,
  sectionStatusLabel,
  sectionLabel,
  slotText,
  useOpsQuery,
} from './lecturer-ui';
import { openPortalPath, useOpsCopy } from './shared/helpers';
import { configuredPortalUrl } from './shared/portal-url';
import { previewGrading, previewSchedule } from './shared/preview';
import { useOpsStyles } from './shared/styles';

export function LecturerDashboardScreen({ navigation }: MobileScreenProps) {
  const styles = useOpsStyles();
  const { copy, locale } = useOpsCopy();
  const { formatDateTime, formatNumber } = useLocale();
  const preview = isOpsPreview();
  const schedule = useOpsQuery('lecturer:schedule', () => lecturerApi.schedule(), copy);
  const grading = useOpsQuery('lecturer:grading', () => lecturerApi.gradingSections(), copy);
  const announcements = useOpsQuery('lecturer:announcements', () => campusApi.announcements(1, 5), copy);
  const profile = useOpsQuery('lecturer:profile', () => campusApi.profile(), copy);
  const pull = usePullToRefresh(() => Promise.all([schedule.reload(), grading.reload(), announcements.reload()]));

  const sections = useMemo(() => (preview ? previewSchedule : schedule.data ?? []), [preview, schedule.data]);
  const gradingSections = useMemo(() => (preview ? previewGrading : grading.data ?? []), [preview, grading.data]);
  const announcementRows = useMemo(() => (preview ? [] : announcements.data?.data ?? []), [preview, announcements.data]);
  const announcementsTotal = preview ? 0 : announcements.data?.meta?.total ?? announcementRows.length;
  const firstName = preview ? undefined : profile.data?.firstName ?? undefined;

  const metrics = dashboardMetrics(sections, gradingSections, announcementsTotal);
  const pending = gradingSections.reduce((total, section) => total + Math.max(section.enrolledCount - section.gradedCount, 0), 0);

  const today = dayNumberOf(new Date());
  const todayClasses = sections
    .flatMap((section) => (section.schedules ?? []).filter((slot) => normalizeDay(slot.dayOfWeek) === today).map((slot) => ({ section, slot })))
    .sort((left, right) => left.slot.startTime.localeCompare(right.slot.startTime));

  const announcementItems = useMemo(() => announcementRows.map((item) => {
    const title = typeof item.title === 'string' ? item.title : '';
    const content = typeof item.content === 'string' ? item.content.replace(/<[^>]*>/g, '').trim() : '';
    const createdAt = typeof item.createdAt === 'string' ? item.createdAt : undefined;
    return { id: typeof item.id === 'string' ? item.id : title, title, content, createdAt };
  }).filter((item) => item.title), [announcementRows]);

  const loading = !preview && (schedule.isLoading || grading.isLoading || announcements.isLoading);
  const error = preview ? null : schedule.error ?? grading.error ?? announcements.error;
  const warning = preview ? null : schedule.warning ?? grading.warning ?? announcements.warning;
  const reload = () => { void schedule.reload(); void grading.reload(); void announcements.reload(); };
  const title = firstName ? fillCopy(copy.dashboardTitleNamed, { name: firstName }) : copy.dashboardTitle;

  const [announceNote, setAnnounceNote] = useState<string | null>(null);
  const openAnnouncements = () => {
    if (!configuredPortalUrl()) {
      setAnnounceNote(copy.webUnavailable);
      return;
    }
    setAnnounceNote(null);
    void openPortalPath('/dashboard/lecturer/announcements').then((opened) => {
      if (!opened) setAnnounceNote(copy.webOpenFailed);
    });
  };

  const heroTitle = todayClasses.length > 0
    ? fillCopy(countForm(todayClasses.length, copy.todayClassesCountOne, copy.todayClassesCount), { n: formatNumber(todayClasses.length) })
    : copy.noClassToday;
  const heroDetail = fillCopy(countForm(metrics.students, copy.studentsCountOne, copy.studentsCount), { n: formatNumber(metrics.students) });

  return (
    <OpsShell
      title={title}
      eyebrow={copy.dashboardEyebrow}
      subtitle={copy.dashboardDescription}
      loading={loading}
      error={error}
      warning={warning}
      onRetry={reload}
      onRefresh={preview ? undefined : pull.onRefresh}
      refreshing={!preview && pull.refreshing}
    >
      <StatStrip
        style={styles.stats}
        items={[
          { icon: 'book-open-page-variant-outline', label: copy.dashboardMetricSections, value: formatNumber(metrics.sections) },
          { icon: 'account-group-outline', label: copy.metricStudents, value: formatNumber(metrics.students) },
          { icon: 'file-document-edit-outline', label: copy.metricReadyToPublish, value: formatNumber(metrics.readyToPublish) },
          { icon: 'bullhorn-outline', label: copy.metricFreshNotices, value: formatNumber(metrics.freshNotices) },
        ]}
      />

      <ScreenSpacer />
      <SectionCard icon="briefcase-outline" title={copy.quickActionsTitle}>
        <ListRow
          icon="calendar-month-outline"
          title={copy.scheduleTitle}
          onPress={() => navigation.navigate('lecturer.schedule')}
          trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
        <Divider />
        <ListRow
          icon="file-document-edit-outline"
          title={copy.gradingTitle}
          onPress={() => navigation.navigate('lecturer.grading')}
          trailing={pending > 0 ? <StatusPill label={formatNumber(pending)} tone="warning" /> : <UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
        <Divider />
        <View style={styles.stack}>
          <Button icon="bullhorn-outline" label={copy.announcementsAction} variant="secondary" onPress={openAnnouncements} />
          {announceNote ? <UiText accessibilityRole="alert" variant="bodySmall" tone="error">{announceNote}</UiText> : null}
        </View>
        <Divider />
        <ListRow
          icon="account-check-outline"
          title={copy.attendanceTitle}
          onPress={() => navigation.navigate('lecturer.attendance')}
          trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
      </SectionCard>

      <ScreenSpacer />
      <SectionCard icon="file-document-edit-outline" title={copy.gradingQueueTitle}>
        {gradingSections.length === 0 ? (
          <StatePanel kind="empty" title={copy.gradingQueueEmptyTitle} description={copy.gradingQueueEmptyDescription} />
        ) : (
          gradingSections.slice(0, 4).map((section, index) => (
            <View key={section.sectionId}>
              {index > 0 ? <Divider /> : null}
              <ListRow
                icon="file-document-edit-outline"
                title={`${section.courseCode ?? ''} - ${courseTitle(section, locale)}`}
                subtitle={[section.sectionNumber ? `${copy.sectionPrefix} ${section.sectionNumber}` : copy.sectionPrefix, termTitle(section, locale)].filter(Boolean).join(' - ')}
                trailing={<StatusPill label={section.canPublish ? copy.queueStatusReady : copy.queueStatusProgress} />}
              />
              <ProgressBar
                value={gradedPercent(section.gradedCount, section.enrolledCount)}
                label={`${formatNumber(section.gradedCount)}/${formatNumber(section.enrolledCount)} ${copy.gradedSuffix}`}
                tone={section.canPublish ? 'success' : 'primary'}
              />
            </View>
          ))
        )}
      </SectionCard>

      <ScreenSpacer />
      <SectionCard icon="calendar-month-outline" title={copy.sectionsInScopeTitle}>
        {sections.length === 0 ? (
          <StatePanel kind="empty" title={copy.sectionsInScopeEmptyTitle} description={copy.sectionsInScopeEmptyDescription} />
        ) : (
          sections.slice(0, 5).map((section, index) => (
            <View key={section.sectionId}>
              {index > 0 ? <Divider /> : null}
              <ListRow
                icon="book-open-outline"
                title={`${section.courseCode ?? ''} - ${courseTitle(section, locale)}`}
                subtitle={[section.sectionNumber ? `${copy.sectionPrefix} ${section.sectionNumber}` : copy.sectionPrefix, departmentTitle(section, locale)].filter(Boolean).join(' - ')}
                meta={`${formatNumber(section.enrolledCount ?? 0)}${section.capacity ? `/${formatNumber(section.capacity)}` : ''} ${copy.studentsSuffix}`}
                trailing={<StatusPill label={sectionStatusLabel(section.status, copy)} />}
                stackedMeta
              />
            </View>
          ))
        )}
      </SectionCard>

      <ScreenSpacer />
      <SectionCard icon="bullhorn-outline" title={copy.announcementsTitle}>
        {announcementItems.length === 0 ? (
          <StatePanel kind="empty" title={copy.announcementsEmptyTitle} description={copy.announcementsEmptyDescription} />
        ) : (
          announcementItems.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Divider /> : null}
              <ListRow
                icon="bullhorn-outline"
                title={item.title}
                subtitle={item.content || undefined}
                meta={item.createdAt ? formatDateTime(item.createdAt) : undefined}
                stackedMeta
              />
            </View>
          ))
        )}
      </SectionCard>

      <ScreenSpacer />
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

      <ScreenSpacer />
      <SectionCard icon="calendar-clock-outline" title={copy.scheduleTitle}>
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
      <LaneEntries groups={['dean', 'staff']} navigation={navigation} />
      <SectionHeading title={copy.handoffTitle} />
      <HandoffButton label={copy.mailTitle} path="/dashboard/lecturer/mail" />
      <HandoffButton label={copy.importTitle} path="/dashboard/lecturer/grades" />
      <HandoffButton label={copy.printTitle} path="/dashboard/lecturer/grades" />
      <HandoffButton label={copy.announcementsAction} path="/dashboard/lecturer/announcements" />
      <HandoffButton label={copy.materialsTitle} path="/dashboard/lecturer/learn" />
    </OpsShell>
  );
}
