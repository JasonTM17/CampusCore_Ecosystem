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
import { fillShellCopy, shellMessages } from '../../i18n/shell-messages';
import { useLocale } from '../../i18n/locale-provider';
import type { MobileScreenProps } from '../../navigation/types';
import { useLiveResource } from './shared/useLiveResource';
import { upcomingClasses } from './shared/preview';
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
    'enrollments',
    [],
    () => campusApi.enrollments(),
    c.loadError,
  );
  const {
    data: liveAnnouncements,
    error: announcementsError,
  } = useLiveResource<JsonObject[]>(
    'announcements',
    [],
    async () => (await campusApi.announcements()).data ?? [],
    c.announcementsError,
  );
  const activeEnrollments = liveEnrollments.filter((item) => item.status === 'ENROLLED');
  const dashboardClasses: Array<{ semesterId?: string; code: string; name: string; time: string; room: string }> = apiClient.mode === 'preview'
    ? upcomingClasses
    : activeEnrollments.slice(0, 3).map((item) => ({
        code: item.section?.course?.code ?? item.section?.sectionNumber ?? c.course,
        name: item.section?.course?.nameVi ?? item.section?.course?.name ?? c.course,
        time: item.section?.schedules?.[0]
          ? `${item.section.schedules[0].startTime} – ${item.section.schedules[0].endTime}`
          : c.schedulePending,
        room: item.section?.schedules?.[0]?.classroom
          ? `${item.section.schedules[0].classroom?.building ?? ''}${item.section.schedules[0].classroom?.roomNumber ? ` ${item.section.schedules[0].classroom.roomNumber}` : ''}`.trim()
          : c.roomTba,
        semesterId: item.semesterId,
      }));
  const scheduledSessions = activeEnrollments.reduce((total, item) => total + (item.section?.schedules?.length ?? 0), 0);

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
      eyebrow={apiClient.mode === 'preview' ? c.previewEyebrow : c.eyebrow}
      title={c.title}
    >
      {warning ? <DataNotice message={warning} /> : null}
      <HeroCard
        icon="school-outline"
        eyebrow={c.currentSemester}
        title={apiClient.mode === 'preview' ? c.previewSemester : fillShellCopy(c.activeSections, { n: activeEnrollments.length })}
        detail={apiClient.mode === 'preview' ? undefined : announcementsError ?? fillShellCopy(c.announcements, { n: liveAnnouncements.length })}
      >
        <Button icon="calendar-week-outline" label={c.openSchedule} onPress={() => navigation.navigate('schedule')} variant="secondary" onBrand />
      </HeroCard>

      <StatStrip style={styles.stats} items={[
        { icon: 'book-open-page-variant-outline', label: c.activeLabel, value: apiClient.mode === 'preview' ? '3' : String(activeEnrollments.length) },
        { icon: 'calendar-clock-outline', label: c.weeklyLabel, value: apiClient.mode === 'preview' ? '2' : String(scheduledSessions) },
      ]} />

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
});
