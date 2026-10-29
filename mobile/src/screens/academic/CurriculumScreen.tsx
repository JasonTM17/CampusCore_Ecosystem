import { groupedRows } from '../../components/perf/grouped-rows';
import { GroupCard } from '../../components/perf/group-card';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Divider, IconChip, MetricCard, ProgressBar, ScreenSpacer, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/choice-field';
import { useLocale } from '../../i18n/locale-provider';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi, type CurriculumCourse } from './academic-api';
import { localizedName } from './academic-model';
import { AcademicShell, academicStyles, isPreviewMode, useAcademicCopy, useAcademicQuery } from './academic-ui';

type StatusFilter = 'ALL' | CurriculumCourse['status'];

/** Courses grouped by year and term, in curriculum order. */
function groupByTerm(courses: readonly CurriculumCourse[]): Array<{ key: string; year: number; term: number; courses: CurriculumCourse[] }> {
  const groups = new Map<string, { key: string; year: number; term: number; courses: CurriculumCourse[] }>();
  for (const course of courses) {
    const key = `${course.year}-${course.semester}`;
    const group = groups.get(key) ?? { key, year: course.year, term: course.semester, courses: [] };
    group.courses.push(course);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => left.year - right.year || left.term - right.term);
}

export function CurriculumScreen({ navigation }: MobileScreenProps) {
  const { copy, locale } = useAcademicCopy();
  const { formatNumber } = useLocale();
  const preview = isPreviewMode();
  const query = useAcademicQuery('academic.curriculum', () => academicApi.curriculum(), copy);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const data = preview ? null : query.data ?? null;

  const groups = useMemo(
    () => groupByTerm((data?.courses ?? []).filter((course) => filter === 'ALL' || course.status === filter)),
    [data, filter],
  );
  const earned = (data?.courses ?? []).filter((course) => course.status === 'COMPLETED').reduce((sum, course) => sum + course.credits, 0);
  const total = data?.curriculum.totalCredits ?? 0;
  const statusLabel = (status: CurriculumCourse['status']) => (status === 'COMPLETED' ? copy.completed : status === 'IN_PROGRESS' ? copy.inProgress : copy.notStarted);

  return (
    <AcademicShell
      title={copy.curriculumTitle}
      loading={!preview && query.isLoading}
      error={preview ? null : query.error}
      warning={preview ? null : query.warning}
      onRetry={() => void query.reload()}

      list={{ data: groupedRows(groups, (group) => group.key, (group) => group.courses, (item) => item.courseId), keyExtractor: (entry) => entry.key,
        renderItem: ({ item: entry }) => { const group = entry.group;
if (entry.kind === "header") return <GroupCard edge={entry.empty ? "single" : "start"} style={academicStyles.card}>
              <View style={styles.termHeading}>
                <IconChip icon="calendar-month-outline" size={32} />
                <UiText accessibilityRole="header" variant="headlineSmall" style={styles.termTitle}>
                  {fillCopy(copy.yearTerm, { year: group.year, term: group.term })}
                </UiText>
              </View>
              </GroupCard>;
const course = entry.item;
return <GroupCard edge={entry.last ? "end" : "middle"} style={academicStyles.card}>{(
                <View key={course.courseId} accessible accessibilityLabel={`${course.code} ${localizedName(course, locale, course.code)}, ${statusLabel(course.status)}`}>
                  <Divider />
                  <View style={styles.courseRow}>
                    <IconChip icon="book-open-variant" size={32} tone="neutral" />
                    <View style={academicStyles.rowCopy}>
                      <StatusPill label={course.code} tone="primary" />
                      <UiText variant="bodyMedium">{localizedName(course, locale, course.code)}</UiText>
                      <UiText variant="meta" tone="muted">{fillCopy(copy.credits, { n: course.credits })}</UiText>
                      {course.prerequisites && course.prerequisites.length > 0 ? (
                        <UiText variant="meta" tone="muted">{fillCopy(copy.prerequisites, { list: course.prerequisites.join(', ') })}</UiText>
                      ) : null}
                    </View>
                    <View style={styles.coursePills}>
                      <StatusPill label={statusLabel(course.status)} tone={course.status === 'COMPLETED' ? 'success' : course.status === 'IN_PROGRESS' ? 'primary' : 'neutral'} />
                      <StatusPill label={course.isMandatory ? copy.mandatory : copy.elective} tone="neutral" />
                    </View>
                  </View>
                </View>
              )}</GroupCard>; },
        footer: <>{!data || data.courses.length === 0 ? null : (<View>
          <Button label={copy.openRegistration} onPress={() => navigation.navigate('registration')} variant="secondary" />
        </View>)}
    </>,
      }}
    >
      {!data || data.courses.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptyCurriculum} />
      ) : (<View>
          <View style={academicStyles.metrics}>
            <MetricCard icon="book-check-outline" label={copy.creditsEarned} value={formatNumber(earned)} style={academicStyles.metric} />
            <MetricCard icon="book-open-outline" label={copy.creditsLabel} value={formatNumber(total)} style={academicStyles.metric} />
          </View>
          <Card tone="primary">
            <View style={styles.curriculumTitle}>
              <IconChip icon="school-outline" />
              <View style={styles.curriculumCopy}>
                <UiText variant="meta" tone="primary">{data.curriculum.code}</UiText>
                <UiText accessibilityRole="header" variant="headlineSmall">{localizedName(data.curriculum, locale, data.curriculum.code)}</UiText>
              </View>
            </View>
            <ProgressBar
              label={fillCopy(copy.curriculumProgress, { earned, total })}
              value={total > 0 ? (earned / total) * 100 : 0}
              tone="success"
            />
          </Card>
          <ScreenSpacer />
          <ChoiceField
            label={copy.filterStatus}
            value={filter}
            onChange={(value) => setFilter(value as StatusFilter)}
            display="sheet"
            options={[
              { value: 'ALL', label: copy.filterAll },
              { value: 'COMPLETED', label: copy.completed },
              { value: 'IN_PROGRESS', label: copy.inProgress },
              { value: 'NOT_STARTED', label: copy.notStarted },
            ]}
          />
          {groups.length === 0 ? <StatePanel kind="empty" title={copy.emptyCurriculum} /> : null}
          </View>)}</AcademicShell>
  );
}

const styles = StyleSheet.create({
  curriculumTitle: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  curriculumCopy: { flex: 1, gap: 4, minWidth: 0 },
  termHeading: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 8 },
  termTitle: { flex: 1, minWidth: 0 },
  courseRow: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
  coursePills: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
