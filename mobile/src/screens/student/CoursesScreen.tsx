import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  DataNotice,
  ProgressBar,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { apiClient, campusApi, type MobileEnrollment } from '../../api/client';
import type { MobileScreenProps } from '../../navigation/types';
import { useLiveResource } from './shared/useLiveResource';
import { courses } from './shared/preview';
import { useWindowClass } from '../../design/theme';
import { useStudentStyles } from './shared/styles';

export function CoursesScreen({ navigation }: MobileScreenProps) {
  const styles = useStudentStyles();
  const { class: windowClass } = useWindowClass();
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
    'Courses are unavailable.',
  );
  const visibleCourses: Array<{ semesterId?: string; code: string; name: string; lecturer: string; progress: number; status: string }> = apiClient.mode === 'preview'
    ? courses
    : liveEnrollments
      .filter((item) => item.status === 'ENROLLED')
      .map((item) => ({
        code: item.section?.course?.code ?? item.section?.sectionNumber ?? item.sectionId,
        name: item.section?.course?.nameVi ?? item.section?.course?.name ?? 'Course',
        lecturer: item.section?.sectionNumber ?? 'Section',
        progress: item.gradeStatus === 'PUBLISHED' ? 100 : 50,
        status: item.status,
        semesterId: item.semesterId,
      }));

  if (isLoading || error) {
    return (
      <ScreenShell title="Courses" eyebrow="My learning" subtitle="Your active courses this semester.">
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? 'Loading courses…' : 'Courses unavailable'}
          description={error ?? 'Retrieving your active course records.'}
          actionLabel={error ? 'Try again' : undefined}
          onAction={error ? () => void reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Courses" eyebrow="My learning" subtitle={`${visibleCourses.length} active courses this semester.`}>
      {warning ? <DataNotice message={warning} /> : null}
      <Card tone="primary" style={styles.summaryCard}>
        <UiText variant="bodySmall" tone="muted">Credits completed</UiText>
        <UiText variant="display" tone="primary">{visibleCourses.length}</UiText>
        <ProgressBar label="Published course records" value={visibleCourses.length > 0 ? 100 : 0} />
      </Card>
      <ScreenSpacer />
      <SectionHeading title="Active courses" actionLabel="Grades" onAction={() => navigation.navigate('grades')} />
      <View testID="course-grid" style={windowClass === 'compact' ? undefined : styles.cardGrid}>
      {visibleCourses.map((course) => (
        <Card key={`${course.semesterId ?? 'na'}-${course.code}`} style={[styles.courseCard, windowClass === 'compact' ? undefined : styles.cardGridItem]}>
          <View style={styles.courseHeader}>
            <View style={styles.courseCopy}>
              <UiText variant="meta" tone="primary">{course.code}</UiText>
              <UiText variant="headlineSmall">{course.name}</UiText>
              <UiText variant="bodySmall" tone="muted">{course.lecturer}</UiText>
            </View>
            <Badge label={course.status} tone={course.progress > 80 ? 'success' : 'primary'} />
          </View>
          <ProgressBar label="Course progress" value={course.progress} />
        </Card>
      ))}
      </View>
      {visibleCourses.length === 0 ? <StatePanel kind="empty" title="No active courses" description="Confirmed enrollment records will appear here." /> : null}
      <Button label="Open registration round" onPress={() => navigation.navigate('registration')} variant="secondary" />
    </ScreenShell>
  );
}
