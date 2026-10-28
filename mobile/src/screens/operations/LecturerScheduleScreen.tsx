import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  DataNotice,
  ScreenShell,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { apiClient, campusApi } from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import type { MobileScreenProps } from '../../navigation/types';
import { lecturerErrorMessage, scheduleLine, lecturerName } from './shared/helpers';
import { previewSchedule } from './shared/preview';
import { useOpsStyles } from './shared/styles';

export function LecturerScheduleScreen({ navigation }: MobileScreenProps) {
  const styles = useOpsStyles();
  const isPreview = apiClient.mode === 'preview';
  const query = useScreenQuery('lecturer:schedule', () => campusApi.lecturerSchedule(), {
    enabled: !isPreview,
    errorMessage: 'Teaching schedule is unavailable.',
    mapError: (error) => lecturerErrorMessage(error, 'Teaching schedule is unavailable.'),
  });
  const sections = isPreview ? previewSchedule : query.data ?? [];

  if (query.isLoading || query.error) {
    return (
      <ScreenShell title="Teaching schedule" eyebrow="Lecturer workspace">
        <StatePanel
          kind={query.isLoading ? 'loading' : 'error'}
          title={query.isLoading ? 'Loading schedule…' : 'Schedule unavailable'}
          description={query.error ?? 'Retrieving your sections.'}
          actionLabel={query.error ? 'Try again' : undefined}
          onAction={query.error ? () => void query.reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Teaching schedule" eyebrow="Lecturer workspace" subtitle="Your sections and the next handoff.">
      {query.warning ? <DataNotice message={query.warning} /> : null}
      {sections.length === 0 ? (
        <StatePanel kind="empty" title="No sections" description="Sections appear after the academic office assigns your teaching load." />
      ) : null}
      {sections.map((item) => (
        <Card key={item.sectionId} style={styles.scheduleCard}>
          <View style={styles.scheduleHeader}>
            <View style={styles.topicCopy}>
              <UiText variant="meta" tone="primary">{item.courseCode ?? item.sectionNumber ?? item.sectionId}</UiText>
              <UiText variant="headlineSmall">{lecturerName(item)}</UiText>
              <UiText variant="bodySmall" tone="muted">{scheduleLine(item)}</UiText>
            </View>
            <Badge label={`${item.enrolledCount ?? 0} students`} tone="neutral" />
          </View>
          <Button
            label="Take attendance"
            onPress={() => navigation.navigate('lecturer.attendance', { sectionId: item.sectionId })}
            variant="secondary"
            style={styles.topButton}
          />
        </Card>
      ))}
      <Button label="Open gradebook" onPress={() => navigation.navigate('lecturer.grading')} variant="secondary" />
    </ScreenShell>
  );
}
