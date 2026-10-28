import { View } from 'react-native';

import {
  Badge,
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
import { apiClient, campusApi } from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import type { MobileScreenProps } from '../../navigation/types';
import { lecturerErrorMessage, scheduleLine } from './shared/helpers';
import { previewSchedule, previewGrading } from './shared/preview';
import { useOpsStyles } from './shared/styles';

export function LecturerDashboardScreen({ navigation }: MobileScreenProps) {
  const styles = useOpsStyles();
  const isPreview = apiClient.mode === 'preview';
  const schedule = useScreenQuery('lecturer:schedule', () => campusApi.lecturerSchedule(), {
    enabled: !isPreview,
    errorMessage: 'Teaching schedule is unavailable.',
    mapError: (error) => lecturerErrorMessage(error, 'Teaching schedule is unavailable.'),
  });
  const grading = useScreenQuery('lecturer:grading', () => campusApi.lecturerGradingSections(), {
    enabled: !isPreview,
    errorMessage: 'Grading queue is unavailable.',
    mapError: (error) => lecturerErrorMessage(error, 'Grading queue is unavailable.'),
  });

  const sections = isPreview ? previewSchedule : schedule.data ?? [];
  const gradingSections = isPreview ? previewGrading : grading.data ?? [];
  const pending = gradingSections.reduce(
    (total, section) => total + Math.max(section.enrolledCount - section.gradedCount, 0),
    0,
  );
  const isLoading = schedule.isLoading || grading.isLoading;
  const error = schedule.error ?? grading.error;

  if (isLoading || error) {
    return (
      <ScreenShell title="Lecturer dashboard" eyebrow="Lecturer workspace">
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? 'Loading teaching day…' : 'Dashboard unavailable'}
          description={error ?? 'Retrieving your sections.'}
          actionLabel={error ? 'Try again' : undefined}
          onAction={error ? () => { void schedule.reload(); void grading.reload(); } : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Lecturer dashboard" eyebrow="Lecturer workspace" subtitle="Your teaching day, kept readable.">
      {schedule.warning ?? grading.warning ? <DataNotice message={schedule.warning ?? grading.warning ?? ''} /> : null}
      <Card tone="primary" style={styles.hero}>
        <UiText variant="meta" tone="primary">LECTURER WORKSPACE</UiText>
        <UiText variant="headlineSmall" style={styles.heroTitle}>
          {sections.length === 0 ? 'No sections assigned yet.' : `${sections.length} section${sections.length === 1 ? '' : 's'} on your roster.`}
        </UiText>
        <UiText variant="bodySmall" tone="muted">Attendance and grading actions are one tap away.</UiText>
      </Card>
      <ScreenSpacer />
      <View style={styles.metricGrid}>
        <MetricCard label="Sections" value={String(sections.length)} detail="Assigned to you" style={styles.metricLeft} />
        <MetricCard label="To grade" value={String(pending)} detail="Pending scores" />
      </View>
      <ScreenSpacer />
      <SectionHeading title="Teaching shortcuts" />
      <Card>
        <ListRow leading="◷" title="Teaching schedule" subtitle={sections[0] ? `Next · ${scheduleLine(sections[0])}` : 'No classes scheduled'} onPress={() => navigation.navigate('lecturer.schedule')} trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>} />
        <Divider />
        <ListRow leading="G" title="Gradebook" subtitle={pending > 0 ? `${pending} scores pending` : 'All caught up'} onPress={() => navigation.navigate('lecturer.grading')} trailing={pending > 0 ? <Badge label={String(pending)} tone="warning" /> : <UiText variant="bodyMedium" tone="muted">›</UiText>} />
        <Divider />
        <ListRow leading="P" title="Class attendance" subtitle="Mark today’s attendance" onPress={() => navigation.navigate('lecturer.attendance')} trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>} />
      </Card>
    </ScreenShell>
  );
}
