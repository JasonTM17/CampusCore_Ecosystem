import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, IconChip, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileNavigation } from '../../navigation/types';
import { academicApi } from './academic-api';
import {
  enrollmentCourseCode,
  enrollmentCourseName,
  filterEnrollments,
  tabCounts,
  termOptions,
  type EnrollmentTab,
} from './academic-model';
import { previewEnrollments, previewSemester } from './academic-preview';
import { AcademicShell, SegmentTabs, TermField, academicStyles, isPreviewMode, useAcademicCopy, useAcademicQuery } from './academic-ui';
import { EnrollmentDetail } from './EnrollmentDetail';

export interface EnrollmentWorkspaceProps {
  navigation: MobileNavigation;
  title: 'coursesTitle' | 'enrollmentsTitle';
}

/** Active, past and withdrawn enrollments by term, with a detail view per enrollment. */
/** Two columns once the window leaves the compact class, like the other card lists. */
function gridStyle(windowClass: string, largeText: boolean) {
  return windowClass === 'compact' || largeText
    ? undefined
    : ({ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' } as const);
}

export function EnrollmentWorkspace({ navigation, title }: EnrollmentWorkspaceProps) {
  const { window } = useTheme();
  const windowClass = window.class;
  const largeText = window.fontScale >= 1.3;
  const { copy, locale } = useAcademicCopy();
  const preview = isPreviewMode();
  const enrollmentsQuery = useAcademicQuery('academic.enrollments', () => academicApi.enrollments(), copy);
  const semestersQuery = useAcademicQuery('academic.semesters', () => academicApi.semesters(), copy);
  const [tab, setTab] = useState<EnrollmentTab>('active');
  const [term, setTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const enrollments = useMemo(() => (preview ? previewEnrollments : enrollmentsQuery.data ?? []), [preview, enrollmentsQuery.data]);
  const semesters = useMemo(() => (preview ? [previewSemester] : semestersQuery.data ?? []), [preview, semestersQuery.data]);
  const options = useMemo(() => termOptions(enrollments, semesters, locale), [enrollments, semesters, locale]);
  const counts = tabCounts(enrollments, term || null);
  const rows = filterEnrollments(enrollments, tab, term || null);
  const selected = selectedId ? enrollments.find((item) => item.id === selectedId) ?? null : null;
  const emptyTitle = tab === 'active' ? copy.emptyActive : tab === 'past' ? copy.emptyPast : copy.emptyWithdrawn;

  const loading = !preview && enrollmentsQuery.isLoading;
  const error = preview ? null : enrollmentsQuery.error;

  return (
    <AcademicShell
      title={copy[title]}
      loading={loading}
      error={error}
      warning={preview ? null : enrollmentsQuery.warning}
      onRetry={() => void enrollmentsQuery.reload()}
    >
      {selected ? (
        <EnrollmentDetail enrollment={selected} onBack={() => setSelectedId(null)} />
      ) : (
        <View>
          <TermField options={options} value={term} onChange={setTerm} />
          <SegmentTabs
            label={copy.tabLabel}
            value={tab}
            onChange={(value) => setTab(value as EnrollmentTab)}
            options={[
              { value: 'active', label: `${copy.tabActive} (${counts.active})` },
              { value: 'past', label: `${copy.tabPast} (${counts.past})` },
              { value: 'withdrawn', label: `${copy.tabWithdrawn} (${counts.withdrawn})` },
            ]}
          />
          <View style={academicStyles.gap} />
          {rows.length === 0 ? <StatePanel kind="empty" title={emptyTitle} /> : null}
          <View testID="course-grid" style={gridStyle(windowClass, largeText)}>
            {rows.map((item) => {
              const code = enrollmentCourseCode(item);
              const name = enrollmentCourseName(item, locale);
              return (
                <Pressable
                  key={`${item.semesterId}-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${code} ${name}, ${copy.status[item.status] ?? item.status}`}
                  onPress={() => setSelectedId(item.id)}
                  style={{ minHeight: tokens.layout.touchTarget, width: windowClass === 'compact' || largeText ? '100%' : '48.5%' }}
                >
                  <Card style={academicStyles.card}>
                    <View style={styles.courseRow}>
                      <IconChip icon="book-open-variant" size={40} />
                      <View style={styles.courseCopy}>
                        <View style={styles.courseTags}>
                          <StatusPill label={code} tone="primary" />
                          <StatusPill label={copy.status[item.status] ?? item.status} tone={item.status === 'COMPLETED' ? 'success' : 'primary'} />
                        </View>
                        <UiText variant="headlineSmall">{name}</UiText>
                        <UiText variant="meta" tone="muted">{fillCopy(copy.credits, { n: item.section?.course?.credits ?? 0 })}</UiText>
                        {item.section?.sectionNumber ? (
                          <UiText variant="meta" tone="muted">{copy.sectionLabel}: {item.section.sectionNumber}</UiText>
                        ) : null}
                      </View>
                    </View>
                  </Card>
                </Pressable>
              );
            })}
          </View>
          <Button label={copy.openRegistration} onPress={() => navigation.navigate('registration')} variant="secondary" />
        </View>
      )}
    </AcademicShell>
  );
}

const styles = StyleSheet.create({
  courseRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  courseCopy: { flex: 1, gap: 4, minWidth: 0 },
  courseTags: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
