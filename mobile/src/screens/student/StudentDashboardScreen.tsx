import { View } from 'react-native';

import {
  Button,
  Card,
  DataNotice,
  Divider,
  ListRow,
  MetricCard,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { apiClient, campusApi, type JsonObject, type MobileEnrollment } from '../../api/client';
import { fillShellCopy, shellMessages } from '../../i18n/shell-messages';
import { useLocale } from '../../i18n/locale-provider';
import type { MobileScreenProps } from '../../navigation/types';
import { useLiveResource } from './shared/useLiveResource';
import { upcomingClasses } from './shared/preview';
import { useStudentStyles } from './shared/styles';

export function StudentDashboardScreen({ navigation }: MobileScreenProps) {
  const styles = useStudentStyles();
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
        code: item.section?.course?.code ?? item.section?.sectionNumber ?? item.sectionId,
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
      <Card tone="primary" style={styles.heroCard}>
        <View style={styles.heroCopy}>
          <UiText variant="meta" tone="primary">
            {c.currentSemester}
          </UiText>
          <UiText variant="headlineSmall" style={styles.heroTitle}>
            {apiClient.mode === 'preview' ? c.previewSemester : fillShellCopy(c.activeSections, { n: activeEnrollments.length })}
          </UiText>
          <UiText variant="bodySmall" tone="muted">
            {apiClient.mode === 'preview'
              ? c.previewData
              : fillShellCopy(c.announcements, { n: liveAnnouncements.length })}
          </UiText>
        </View>
        <Button label={c.openSchedule} onPress={() => navigation.navigate('schedule')} variant="secondary" />
      </Card>

      <View style={styles.metricGrid}>
        <MetricCard label={c.activeLabel} value={apiClient.mode === 'preview' ? '3' : String(activeEnrollments.length)} style={styles.metricLeft} />
        <MetricCard label={c.weeklyLabel} value={apiClient.mode === 'preview' ? '2' : String(scheduledSessions)} />
      </View>

      <ScreenSpacer />
      <SectionHeading title={c.nextOnSchedule} actionLabel={c.seeAll} onAction={() => navigation.navigate('schedule')} />
      <Card>
        {dashboardClasses.map((item, index) => (
          <View key={`${item.semesterId ?? 'na'}-${item.code}`}>
            <ListRow
              leading={item.code.slice(0, 1)}
              meta={item.time}
              subtitle={`${item.name} · ${fillShellCopy(c.room, { room: item.room })}`}
              title={item.code}
            />
            {index < dashboardClasses.length - 1 ? <Divider /> : null}
          </View>
        ))}
      </Card>
      {dashboardClasses.length === 0 ? <StatePanel kind="empty" title={c.emptyTitle} description={c.emptyDetail} /> : null}

      <ScreenSpacer />
      <SectionHeading title={c.quick} />
      <View style={styles.actionGrid}>
        <Button label={c.registerCourses} onPress={() => navigation.navigate('registration')} variant="secondary" style={styles.actionButton} />
        <Button label={c.viewThesis} onPress={() => navigation.navigate('thesis.topics')} variant="secondary" style={styles.actionButton} />
        <Button label={c.askAssistant} onPress={() => navigation.navigate('assistant.chat')} variant="secondary" style={styles.actionButton} />
      </View>
    </ScreenShell>
  );
}
