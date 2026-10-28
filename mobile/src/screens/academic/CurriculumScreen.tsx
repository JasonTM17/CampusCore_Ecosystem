import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, Divider, ProgressBar, ScreenSpacer, StatePanel, UiText } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/choice-field';
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
    >
      {!data || data.courses.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptyCurriculum} />
      ) : (
        <View>
          <Card tone="primary">
            <UiText variant="meta" tone="primary">{data.curriculum.code}</UiText>
            <UiText accessibilityRole="header" variant="headlineSmall">{localizedName(data.curriculum, locale, data.curriculum.code)}</UiText>
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
          {groups.map((group) => (
            <Card key={group.key} style={academicStyles.card}>
              <UiText accessibilityRole="header" variant="label" tone="primary">
                {fillCopy(copy.yearTerm, { year: group.year, term: group.term })}
              </UiText>
              {group.courses.map((course) => (
                <View key={course.courseId} accessible accessibilityLabel={`${course.code} ${localizedName(course, locale, course.code)}, ${statusLabel(course.status)}`}>
                  <Divider />
                  <View style={academicStyles.row}>
                    <View style={academicStyles.rowCopy}>
                      <UiText variant="label">{course.code}</UiText>
                      <UiText variant="bodySmall" tone="muted">
                        {localizedName(course, locale, course.code)} · {fillCopy(copy.credits, { n: course.credits })}
                      </UiText>
                      {course.prerequisites && course.prerequisites.length > 0 ? (
                        <UiText variant="meta" tone="muted">{fillCopy(copy.prerequisites, { list: course.prerequisites.join(', ') })}</UiText>
                      ) : null}
                    </View>
                    <View>
                      <Badge label={statusLabel(course.status)} tone={course.status === 'COMPLETED' ? 'success' : course.status === 'IN_PROGRESS' ? 'primary' : 'neutral'} />
                      <Badge label={course.isMandatory ? copy.mandatory : copy.elective} tone="neutral" />
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          ))}
          <Button label={copy.openRegistration} onPress={() => navigation.navigate('registration')} variant="secondary" />
        </View>
      )}
    </AcademicShell>
  );
}
