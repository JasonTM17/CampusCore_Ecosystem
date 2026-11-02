import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ActionTile,
  Button,
  DataNotice,
  Divider,
  HeroCard,
  ListRow,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  SectionCard,
  StatStrip,
  StatePanel,
} from '../../components/Ui';
import { apiClient, campusApi, type JsonObject, type MobileEnrollment } from '../../api/client';
import { countForm } from '../../i18n/locale';
import { fillShellCopy, shellMessages } from '../../i18n/shell-messages';
import { buildAgenda, localizedName, nextMeetings } from '../academic/academic-model';
import { useLocale } from '../../i18n/locale-provider';
import type { MobileScreenProps } from '../../navigation/types';
import { useLiveResource } from './shared/useLiveResource';
import { CheckinEntryCard } from '../attendance-checkin/CheckinEntryCard';
import { upcomingClasses, courses as previewCourses } from './shared/preview';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';

export const StudentDashboardScreen = memo(function StudentDashboardScreen({ navigation }: MobileScreenProps) {
  const { window } = useTheme();
  const largeText = window.fontScale >= 1.3;
  const { locale } = useLocale();
  const c = shellMessages[locale].dashboard;
  const {
    data: liveEnrollments,
    error,
    warning,
    isLoading,
    reload,
  } = useLiveResource<MobileEnrollment[]>(
    'academic.enrollments',
    [],
    () => campusApi.enrollments(),
    c.loadError,
  );
  const {
    data: liveAnnouncements,
    error: announcementsError,
    isLoading: announcementsLoading,
    reload: reloadAnnouncements,
  } = useLiveResource<JsonObject[]>(
    'announcements',
    [],
    async () => (await campusApi.announcements()).data ?? [],
    c.announcementsError,
  );
  const activeEnrollments = liveEnrollments.filter((item) => item.status === 'ENROLLED');
  const upcoming = apiClient.mode === 'preview'
    ? []
    : nextMeetings(buildAgenda(activeEnrollments, locale), new Date(), 3);
  const pendingRows = activeEnrollments
    .filter((item) => !(item.section?.schedules?.length))
    .slice(0, Math.max(0, 3 - upcoming.length))
    .map((item) => ({
      code: item.section?.course?.code ?? item.section?.sectionNumber ?? c.course,
      name: localizedName(item.section?.course, locale, c.course),
      time: c.schedulePending,
      room: c.roomTba,
      semesterId: item.semesterId,
    }));
  const dashboardClasses: Array<{ semesterId?: string; code: string; name: string; time: string; room: string }> = apiClient.mode === 'preview'
    ? upcomingClasses
    : [
        ...upcoming.map((item) => ({
          code: item.courseCode || item.sectionNumber || c.course,
          name: item.courseName || c.course,
          time: `${item.startTime} – ${item.endTime}`,
          room: item.room || c.roomTba,
          semesterId: item.semesterId,
        })),
        ...pendingRows,
      ];
  const scheduledSessions = activeEnrollments.reduce((total, item) => total + (item.section?.schedules?.length ?? 0), 0);
  const activeSectionCount = apiClient.mode === 'preview' ? previewCourses.length : activeEnrollments.length;

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
    >
      {warning ? <DataNotice message={warning} /> : null}
      <HeroCard
        icon="school-outline"
        eyebrow={c.currentSemester}
        title={fillShellCopy(countForm(activeSectionCount, c.activeSectionsOne, c.activeSections), { n: activeSectionCount })}
        detail={apiClient.mode === 'preview' || announcementsError || announcementsLoading ? undefined : fillShellCopy(countForm(liveAnnouncements.length, c.announcementsOne, c.announcements), { n: liveAnnouncements.length })}
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
        { icon: 'book-open-page-variant-outline', label: c.activeLabel, value: apiClient.mode === 'preview' ? String(previewCourses.length) : String(activeEnrollments.length) },
        { icon: 'calendar-clock-outline', label: c.weeklyLabel, value: apiClient.mode === 'preview' ? '2' : String(scheduledSessions) },
      ]} />

      <ScreenSpacer />
      <CheckinEntryCard navigation={navigation} />
      <ScreenSpacer />
      <SectionHeading title={c.quick} />
      <View style={[styles.actionGrid, largeText ? styles.actionStack : undefined]}>
        <ActionTile compact={largeText} icon="clipboard-edit-outline" label={c.registerCourses} onPress={() => navigation.navigate('registration')} />
        <ActionTile compact={largeText} icon="school-outline" label={c.viewThesis} onPress={() => navigation.navigate('thesis.topics')} />
        <ActionTile compact={largeText} icon="robot-outline" label={c.askAssistant} onPress={() => navigation.navigate('assistant.chat')} />
      </View>

      <ScreenSpacer />
      <SectionCard icon="calendar-clock-outline" title={c.nextOnSchedule} actionLabel={c.seeAll} onAction={() => navigation.navigate('schedule')}>
        {dashboardClasses.map((item, index) => (
          <View key={`${item.semesterId ?? 'na'}-${item.code}`}>
            <ListRow
              icon="book-open-outline"
              meta={item.time}
              subtitle={`${item.name} · ${fillShellCopy(c.room, { room: item.room })}`}
              title={item.code}
              stackedMeta
            />
            {index < dashboardClasses.length - 1 ? <Divider /> : null}
          </View>
        ))}
      </SectionCard>
      {dashboardClasses.length === 0 ? <StatePanel kind="empty" title={c.emptyTitle} description={c.emptyDetail} /> : null}
    </ScreenShell>
  );
});

const styles = StyleSheet.create({
  stats: { marginTop: tokens.spacing.sm + tokens.spacing.xs },
  actionGrid: { flexDirection: 'row', alignItems: 'stretch', gap: tokens.spacing.sm },
  actionStack: { flexDirection: 'column' },
  announcementError: { gap: tokens.spacing.xs },
});
