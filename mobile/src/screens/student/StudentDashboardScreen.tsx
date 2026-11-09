import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  ActionTile,
  Badge,
  Button,
  DataNotice,
  Divider,
  HeroCard,
  IconChip,
  ListRow,
  ProgressBar,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  SectionCard,
  StatePanel,
  StatusPill,
  StatStrip,
  UiText,
} from '../../components/Ui';
import type { UiIconName } from '../../components/Ui';
import { apiClient, campusApi, type MobileAnnouncementPage } from '../../api/client';
import { academicMessages } from '../../i18n/academic-messages';
import { countForm, formatLongDate, formatNumber } from '../../i18n/locale';
import { fillShellCopy, shellMessages } from '../../i18n/shell-messages';
import {
  buildAgenda,
  dayShortIndex,
  isActiveEnrollment,
  localizedName,
  meetingShift,
  upcomingMeetings,
} from '../academic/academic-model';
import { academicApi, type DashboardAcademics } from '../academic/academic-api';
import { useLocale } from '../../i18n/locale-provider';
import type { MobileScreenProps } from '../../navigation/types';
import type { ScreenName } from '../../navigation/routes';
import { useLiveResource } from './shared/useLiveResource';
import { CheckinEntryCard } from '../attendance-checkin/CheckinEntryCard';
import { upcomingClasses, courses as previewCourses } from './shared/preview';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';

const EMPTY_OVERVIEW: DashboardAcademics = {
  semesterId: null,
  semester: null,
  enrollments: [],
  creditLimit: null,
};

export const StudentDashboardScreen = memo(function StudentDashboardScreen({ navigation }: MobileScreenProps) {
  const { window, colors } = useTheme();
  const largeText = window.fontScale >= 1.3;
  const { locale } = useLocale();
  const c = shellMessages[locale].dashboard;
  const statusCopy = academicMessages[locale].status;
  const preview = apiClient.mode === 'preview';
  const {
    data: overview,
    error,
    warning,
    isLoading,
    reload,
  } = useLiveResource<DashboardAcademics>(
    'academic.dashboard',
    EMPTY_OVERVIEW,
    () => academicApi.dashboard(),
    c.loadError,
  );
  const {
    data: announcementsPage,
    error: announcementsError,
    isLoading: announcementsLoading,
    reload: reloadAnnouncements,
  } = useLiveResource<MobileAnnouncementPage>(
    'announcements',
    { data: [] },
    () => campusApi.announcements(),
    c.announcementsError,
  );
  const announcementRows = announcementsPage.data ?? [];
  const announcementTotal = announcementsPage.meta?.total ?? announcementRows.length;
  const enrollments = preview ? [] : overview.enrollments;
  const activeEnrollments = enrollments.filter((item) => isActiveEnrollment(item.status));
  const pendingCourses = enrollments.filter((item) => item.status === 'PENDING');
  const confirmedCount = enrollments.filter((item) => item.status === 'ENROLLED').length;
  const semesterName = localizedName(overview.semester, locale, c.currentTermFallback) || c.currentTermFallback;
  const activeCredits = activeEnrollments.reduce((sum, item) => sum + (item.section?.course?.credits ?? 0), 0);
  const creditCap = overview.creditLimit;
  const creditPercent = creditCap ? Math.min(100, Math.round((activeCredits / creditCap) * 100)) : null;
  const creditRemaining = creditCap ? Math.max(0, creditCap - activeCredits) : null;
  const activeSectionCount = preview ? previewCourses.length : activeEnrollments.length;
  const meetingRows = preview ? [] : upcomingMeetings(buildAgenda(activeEnrollments, locale), new Date(), 3);
  const previewUpcoming = preview
    ? upcomingClasses.map((item) => ({ ...item, name: localizedName(item, locale) || item.name }))
    : [];
  const highlightedCourses = preview
    ? previewCourses.slice(0, 3).map((course, index) => ({
        id: `preview-${index}`,
        status: 'ENROLLED',
        code: course.code,
        name: localizedName(course, locale) || course.name,
      }))
    : activeEnrollments.slice(0, 3).map((item) => ({
        id: item.id,
        status: item.status,
        code: item.section?.course?.code ?? item.section?.sectionNumber ?? c.course,
        name: localizedName(item.section?.course, locale, c.course),
      }));
  const currentCourseCount = preview ? previewCourses.length : activeEnrollments.length;
  const statCourses = preview ? previewCourses.length : activeEnrollments.length;
  const statActive = preview ? previewCourses.length : confirmedCount;
  const statPending = preview ? 0 : pendingCourses.length;
  const quickTiles: Array<{ icon: UiIconName; label: string; route: ScreenName }> = [
    { icon: 'clipboard-list-outline', label: c.registerCourses, route: 'registration' },
    { icon: 'calendar-week-outline', label: c.quickSchedule, route: 'schedule' },
    { icon: 'chart-box-outline', label: c.quickGrades, route: 'grades' },
    { icon: 'file-document-outline', label: c.quickTranscript, route: 'transcript' },
    { icon: 'school-outline', label: c.viewThesis, route: 'thesis.topics' },
    { icon: 'bell-outline', label: c.quickAnnouncements, route: 'announcements' },
  ];

  if (isLoading || error) {
    return (
      <ScreenShell title={c.title} eyebrow={c.eyebrow}>
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? c.loading : c.unavailable}
          description={error ?? c.unavailableDetail}
          actionLabel={error ? c.retry : undefined}
          onAction={error ? () => void reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      eyebrow={c.eyebrow}
      title={c.title}
      headerAction={
        <View style={[styles.dateChip, { borderColor: colors.outlineVariant, backgroundColor: colors.card }]}>
          <UiText variant="meta" tone="muted">{formatLongDate(new Date(), locale)}</UiText>
        </View>
      }
    >
      {warning ? <View style={styles.notice}><DataNotice message={warning} /></View> : null}
      <HeroCard
        icon="school-outline"
        eyebrow={c.currentSemester}
        title={fillShellCopy(countForm(activeSectionCount, c.activeSectionsOne, c.activeSections), { n: activeSectionCount })}
        detail={preview || announcementsError || announcementsLoading ? undefined : fillShellCopy(countForm(announcementTotal, c.announcementsOne, c.announcements), { n: announcementTotal })}
      >
        <Button icon="calendar-week-outline" label={c.openSchedule} onPress={() => navigation.navigate('schedule')} variant="secondary" onBrand />
      </HeroCard>
      {announcementsError ? (
        <View style={styles.announcementError}>
          <DataNotice message={announcementsError} />
          <Button label={c.retry} variant="text" onPress={() => void reloadAnnouncements()} />
        </View>
      ) : null}

      <StatStrip style={styles.stats} items={[
        { icon: 'book-open-outline', label: c.statsCourses, value: formatNumber(statCourses, locale) },
        { icon: 'school-outline', label: c.statsActive, value: formatNumber(statActive, locale) },
        { icon: 'clipboard-list-outline', label: c.statsPending, value: formatNumber(statPending, locale) },
        { icon: 'calendar-month-outline', label: c.statsTerm, value: semesterName },
      ]} />

      <ScreenSpacer />
      <CheckinEntryCard navigation={navigation} />
      <ScreenSpacer />

      <SectionCard icon="calendar-clock-outline" title={c.nextOnSchedule} actionLabel={c.seeAll} onAction={() => navigation.navigate('schedule')}>
        {preview ? previewUpcoming.map((item, index) => (
          <View key={`${item.code}-${item.time}`}>
            <ListRow
              icon="book-open-outline"
              meta={item.time}
              subtitle={`${item.name} · ${fillShellCopy(c.room, { room: item.room })}`}
              title={item.code}
              stackedMeta
            />
            {index < previewUpcoming.length - 1 ? <Divider /> : null}
          </View>
        )) : meetingRows.length === 0 ? (
          <StatePanel
            kind="empty"
            title={c.noMeetings}
            actionLabel={c.openSchedule}
            onAction={() => navigation.navigate('schedule')}
          />
        ) : meetingRows.map((meeting, index) => {
          const item = meeting.item;
          const shift = meetingShift(item.startTime);
          const shiftLabel = shift === 'morning' ? c.shiftMorning : shift === 'afternoon' ? c.shiftAfternoon : c.shiftEvening;
          const shiftTone = shift === 'morning' ? 'warning' : shift === 'afternoon' ? 'primary' : 'neutral';
          const room = item.building && item.roomNumber
            ? fillShellCopy(c.roomWithBuilding, { building: item.building, room: item.roomNumber })
            : item.roomNumber
              ? fillShellCopy(c.roomOnly, { room: item.roomNumber })
              : item.building;
          const dayLabel = c.dayShort[dayShortIndex(item.dayOfWeek)] ?? '';
          const relativeLabel = meeting.daysUntil === 0 ? c.today : meeting.daysUntil === 1 ? c.tomorrow : undefined;
          const title = `${item.courseCode || item.sectionNumber || c.course} — ${item.courseName || c.course}`;
          return (
            <View key={item.id}>
              <Pressable
                accessibilityLabel={[title, dayLabel, relativeLabel, shiftLabel, `${item.startTime}–${item.endTime}`, room].filter(Boolean).join(', ')}
                accessibilityRole="button"
                onPress={() => navigation.navigate('schedule')}
                style={({ pressed }) => [styles.meetingRow, pressed ? { backgroundColor: colors.surfaceLow } : undefined]}
              >
                <View style={[styles.dayBadge, { backgroundColor: meeting.daysUntil === 0 ? colors.primaryFixed : colors.surface }]}>
                  <UiText variant="label" tone={meeting.daysUntil === 0 ? 'primary' : 'muted'}>{dayLabel}</UiText>
                </View>
                <View style={styles.meetingCopy}>
                  <View style={styles.meetingTitleRow}>
                    <UiText variant="bodyMedium" style={{ flexShrink: 1 }}>{title}</UiText>
                    {relativeLabel ? <Badge label={relativeLabel} tone={meeting.daysUntil === 0 ? 'primary' : 'neutral'} /> : null}
                  </View>
                  <View style={styles.meetingMetaRow}>
                    <StatusPill label={shiftLabel} tone={shiftTone} />
                    <UiText variant="meta" tone="muted">{`${item.startTime}–${item.endTime}`}</UiText>
                    {room ? <UiText variant="meta" tone="muted">{room}</UiText> : null}
                  </View>
                </View>
              </Pressable>
              {index < meetingRows.length - 1 ? <Divider /> : null}
            </View>
          );
        })}
      </SectionCard>

      <ScreenSpacer />
      <SectionCard
        icon="chart-timeline-variant"
        title={c.progressTitle}
      >
        <View style={styles.progressHead}>
          <UiText variant="label">{c.creditLabel}</UiText>
          <UiText variant="label" style={{ fontVariant: ['tabular-nums'] }}>
            {`${formatNumber(activeCredits, locale)}${creditCap ? ` / ${formatNumber(creditCap, locale)}` : ''}`}
          </UiText>
        </View>
        <ProgressBar value={creditPercent ?? 0} />
        <View style={styles.progressFoot}>
          <UiText variant="meta" tone="muted" style={{ flexShrink: 1 }}>
            {creditPercent === null ? c.creditsEarnedOnly : fillShellCopy(c.progressStatus, { percent: creditPercent })}
          </UiText>
          {creditRemaining !== null ? (
            <UiText variant="meta">
              {creditRemaining > 0
                ? fillShellCopy(c.creditsAvailable, { remaining: formatNumber(creditRemaining, locale) })
                : c.creditsCapped}
            </UiText>
          ) : null}
        </View>
        {pendingCourses.length > 0 ? (
          <View style={styles.progressPending}>
            <StatusPill
              label={fillShellCopy(countForm(pendingCourses.length, c.pendingBadgeOne, c.pendingBadge), {
                count: formatNumber(pendingCourses.length, locale),
              })}
              tone="warning"
            />
          </View>
        ) : null}
      </SectionCard>

      <ScreenSpacer />
      <SectionCard
        icon="book-open-variant"
        title={c.currentCoursesTitle}
        count={`${formatNumber(currentCourseCount, locale)} ${c.coursesUnit}`}
      >
        {highlightedCourses.length === 0 ? (
          <StatePanel
            kind="empty"
            title={c.emptyCoursesTitle}
            description={c.emptyCoursesDetail}
            actionLabel={c.browseSections}
            onAction={() => navigation.navigate('registration')}
          />
        ) : (
          <>
            {highlightedCourses.map((course, index) => {
              const statusLabel = statusCopy[course.status] ?? statusCopy.UNKNOWN;
              return (
                <View key={course.id}>
                  <Pressable
                    accessibilityLabel={`${course.code} - ${course.name}, ${statusLabel}`}
                    accessibilityRole="button"
                    onPress={() => navigation.navigate('enrollments')}
                    style={({ pressed }) => [styles.courseRow, pressed ? { backgroundColor: colors.surfaceLow } : undefined]}
                  >
                    <IconChip icon="book-open-variant" size={36} />
                    <UiText variant="bodyMedium" style={{ flex: 1, minWidth: 0 }}>{`${course.code} - ${course.name}`}</UiText>
                    <StatusPill label={statusLabel} tone="neutral" />
                  </Pressable>
                  {index < highlightedCourses.length - 1 ? <Divider /> : null}
                </View>
              );
            })}
            {currentCourseCount > 0 ? (
              <View style={[styles.courseFooter, { borderTopColor: colors.outlineVariant }]}>
                <Button label={c.footerSchedule} variant="secondary" onPress={() => navigation.navigate('schedule')} />
                <Button label={c.footerCourses} variant="text" onPress={() => navigation.navigate('enrollments')} />
              </View>
            ) : null}
          </>
        )}
      </SectionCard>

      <ScreenSpacer />
      <SectionHeading title={c.quick} />
      <View testID="quick-access" style={[styles.actionGrid, largeText ? styles.actionStack : undefined]}>
        {quickTiles.map((tile) => (
          <ActionTile
            key={tile.label}
            compact={largeText}
            icon={tile.icon}
            label={tile.label}
            onPress={() => navigation.navigate(tile.route)}
            style={largeText ? styles.actionTileStacked : { flexBasis: window.class === 'compact' ? '46%' : '30%' }}
          />
        ))}
      </View>
    </ScreenShell>
  );
});

const styles = StyleSheet.create({
  dateChip: { borderRadius: tokens.radii.control, borderWidth: 1, marginLeft: tokens.spacing.sm, maxWidth: 168, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.xs },
  stats: { marginTop: tokens.spacing.sm + tokens.spacing.xs },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: tokens.spacing.sm },
  actionStack: { flexDirection: 'column' },
  actionTileStacked: { flexBasis: '100%' },
  announcementError: { gap: tokens.spacing.xs, marginTop: tokens.spacing.sm },
  notice: { marginBottom: tokens.spacing.sm },
  meetingRow: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget + 4, paddingVertical: tokens.spacing.sm },
  dayBadge: { alignItems: 'center', borderRadius: tokens.radii.control, height: 40, justifyContent: 'center', width: 40 },
  meetingCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  meetingTitleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  meetingMetaRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  progressHead: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between', marginTop: tokens.spacing.sm },
  progressFoot: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between', marginTop: tokens.spacing.xs },
  progressPending: { marginTop: tokens.spacing.sm },
  courseRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget + 4, paddingVertical: tokens.spacing.sm },
  courseFooter: { borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between', marginTop: tokens.spacing.sm, paddingTop: tokens.spacing.sm },
});
