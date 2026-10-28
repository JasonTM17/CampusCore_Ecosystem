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
import type { MobileScreenProps } from '../../navigation/types';
import { useLiveResource } from './shared/useLiveResource';
import { upcomingClasses } from './shared/preview';
import { useStudentStyles } from './shared/styles';

export function StudentDashboardScreen({ navigation }: MobileScreenProps) {
  const styles = useStudentStyles();
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
    'Dashboard data is unavailable.',
  );
  const {
    data: liveAnnouncements,
  } = useLiveResource<JsonObject[]>(
    'announcements',
    [],
    async () => (await campusApi.announcements()).data ?? [],
    'Announcements are unavailable.',
  );
  const activeEnrollments = liveEnrollments.filter((item) => item.status === 'ENROLLED');
  const dashboardClasses: Array<{ semesterId?: string; code: string; name: string; time: string; room: string }> = apiClient.mode === 'preview'
    ? upcomingClasses
    : activeEnrollments.slice(0, 3).map((item) => ({
        code: item.section?.course?.code ?? item.section?.sectionNumber ?? item.sectionId,
        name: item.section?.course?.nameVi ?? item.section?.course?.name ?? 'Course',
        time: item.section?.schedules?.[0]
          ? `${item.section.schedules[0].startTime} – ${item.section.schedules[0].endTime}`
          : 'Schedule pending',
        room: item.section?.schedules?.[0]?.classroom
          ? `${item.section.schedules[0].classroom?.building ?? ''}${item.section.schedules[0].classroom?.roomNumber ? ` ${item.section.schedules[0].classroom.roomNumber}` : ''}`.trim()
          : 'TBA',
        semesterId: item.semesterId,
      }));
  const scheduledSessions = activeEnrollments.reduce((total, item) => total + (item.section?.schedules?.length ?? 0), 0);

  if (isLoading || error) {
    return (
      <ScreenShell title="Academic dashboard" eyebrow="Student workspace" subtitle="Your current sections and next academic actions.">
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? 'Loading dashboard…' : 'Dashboard unavailable'}
          description={error ?? 'Retrieving your current academic records.'}
          actionLabel={error ? 'Try again' : undefined}
          onAction={error ? () => void reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      eyebrow={apiClient.mode === 'preview' ? 'Preview workspace' : 'Student workspace'}
      title="Academic dashboard"
      subtitle="Your current sections and next academic actions."
    >
      {warning ? <DataNotice message={warning} /> : null}
      <Card tone="primary" style={styles.heroCard}>
        <View style={styles.heroCopy}>
          <UiText variant="meta" tone="primary">
            CURRENT SEMESTER
          </UiText>
          <UiText variant="headlineSmall" style={styles.heroTitle}>
            {apiClient.mode === 'preview' ? 'Preview semester overview' : `${activeEnrollments.length} active sections`}
          </UiText>
          <UiText variant="bodySmall" tone="muted">
            {apiClient.mode === 'preview'
              ? 'Preview data is local.'
              : `${liveAnnouncements.length} campus announcements available.`}
          </UiText>
        </View>
        <Button label="Open schedule" onPress={() => navigation.navigate('schedule')} variant="secondary" />
      </Card>

      <View style={styles.metricGrid}>
        <MetricCard label="Active sections" value={apiClient.mode === 'preview' ? '3' : String(activeEnrollments.length)} detail="Current semester" style={styles.metricLeft} />
        <MetricCard label="Weekly sessions" value={apiClient.mode === 'preview' ? '2' : String(scheduledSessions)} detail="Published schedule" />
      </View>

      <ScreenSpacer />
      <SectionHeading title="Next on your schedule" actionLabel="See all" onAction={() => navigation.navigate('schedule')} />
      <Card>
        {dashboardClasses.map((item, index) => (
          <View key={`${item.semesterId ?? 'na'}-${item.code}`}>
            <ListRow
              leading={item.code.slice(0, 1)}
              meta={item.time}
              subtitle={`${item.name} · Room ${item.room}`}
              title={item.code}
            />
            {index < dashboardClasses.length - 1 ? <Divider /> : null}
          </View>
        ))}
      </Card>
      {dashboardClasses.length === 0 ? <StatePanel kind="empty" title="No active sections" description="Published sections will appear here." /> : null}

      <ScreenSpacer />
      <SectionHeading title="Quick actions" />
      <View style={styles.actionGrid}>
        <Button label="Register courses" onPress={() => navigation.navigate('registration')} variant="secondary" style={styles.actionButton} />
        <Button label="View thesis" onPress={() => navigation.navigate('thesis.topics')} variant="secondary" style={styles.actionButton} />
        <Button label="Ask assistant" onPress={() => navigation.navigate('assistant.chat')} variant="secondary" style={styles.actionButton} />
      </View>
    </ScreenShell>
  );
}
