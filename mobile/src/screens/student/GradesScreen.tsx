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
import { apiClient, campusApi } from '../../api/client';
import type { MobileScreenProps } from '../../navigation/types';
import { useLiveResource } from './shared/useLiveResource';
import { grades } from './shared/preview';
import { useStudentStyles } from './shared/styles';

export function GradesScreen({ navigation }: MobileScreenProps) {
  const styles = useStudentStyles();
  const {
    data: liveGrades,
    error,
    warning,
    isLoading,
    reload,
  } = useLiveResource<Array<{ id: string; code: string; name: string; score: string; letter: string; detail: string }>>(
    'grades',
    [],
    async () => {
      const items = await campusApi.grades();
      return items.map((item) => ({
        id: item.id,
        code: item.courseCode,
        name: item.courseName,
        score: item.finalGrade == null ? '—' : String(item.finalGrade),
        letter: item.letterGrade ?? '—',
        detail: item.gradeStatus,
      }));
    },
    'Grades are unavailable.',
  );

  const visibleGrades = apiClient.mode === 'preview' ? grades : liveGrades;
  const numericGrades = liveGrades.map((grade) => Number(grade.score)).filter(Number.isFinite);
  const averageGrade = numericGrades.length > 0
    ? (numericGrades.reduce((sum, grade) => sum + grade, 0) / numericGrades.length).toFixed(2)
    : '—';

  if (isLoading || error) {
    return (
      <ScreenShell title="Grades" eyebrow="Academic record" subtitle="Your latest published results.">
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? 'Loading grades…' : 'Grades unavailable'}
          description={error ?? 'Retrieving your published grade records.'}
          actionLabel={error ? 'Try again' : undefined}
          onAction={error ? () => void reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Grades" eyebrow="Academic record" subtitle="Your latest published results.">
      {warning ? <DataNotice message={warning} /> : null}
      <View style={styles.metricGrid}>
        <MetricCard label="Average grade" value={apiClient.mode === 'preview' ? '8.76' : averageGrade} detail="Published results" style={styles.metricLeft} />
        <MetricCard label="Records" value={String(visibleGrades.length)} detail="Current transcript" />
      </View>
      <ScreenSpacer />
      <SectionHeading title="Published grades" actionLabel="Courses" onAction={() => navigation.navigate('courses')} />
      {visibleGrades.length > 0 ? <Card>
        {visibleGrades.map((grade, index) => (
          <View key={grade.id}>
            <ListRow
              leading={grade.letter}
              meta={grade.score}
              subtitle={`${grade.name} · ${grade.detail}`}
              title={grade.code}
              trailing={<UiText variant="bodyMedium" tone="primary">›</UiText>}
            />
            {index < visibleGrades.length - 1 ? <Divider /> : null}
          </View>
        ))}
      </Card> : null}
      {visibleGrades.length === 0 ? <StatePanel kind="empty" title="No published grades" description="Published results will appear here." /> : null}
      <ScreenSpacer />
      <Card tone="low">
        <UiText variant="label">Need a transcript?</UiText>
        <UiText variant="bodySmall" tone="muted" style={styles.cardCopy}>Downloadable transcripts will be available when records are connected.</UiText>
        <Button label="Ask assistant" onPress={() => navigation.navigate('assistant.chat')} variant="secondary" />
      </Card>
    </ScreenShell>
  );
}
