import { groupedRows } from '../../components/perf/grouped-rows';
import { GroupCard } from '../../components/perf/group-card';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Divider, IconChip, MetricCard, ProgressBar, ScreenSpacer, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/choice-field';
import { tokens } from '../../design/tokens';
import { useLocale } from '../../i18n/locale-provider';
import { countForm } from '../../i18n/locale';
import { fillCopy } from '../../i18n/academic-messages';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi, type CurriculumCourse } from './academic-api';
import { localizedName } from './academic-model';
import { previewCurriculum } from './academic-preview';
import { AcademicShell, academicStyles, isPreviewMode, useAcademicCopy, useAcademicQuery } from './academic-ui';

type StatusFilter = 'ALL' | 'AVAILABLE' | CurriculumCourse['status'];

type CourseGroup = { key: string; year: number; term: number; courses: CurriculumCourse[]; firstInYear: boolean };

/** Courses grouped by year and term, in curriculum order. */
function groupByTerm(courses: readonly CurriculumCourse[]): CourseGroup[] {
  const groups = new Map<string, { key: string; year: number; term: number; courses: CurriculumCourse[] }>();
  for (const course of courses) {
    const key = `${course.year}-${course.semester}`;
    const group = groups.get(key) ?? { key, year: course.year, term: course.semester, courses: [] };
    group.courses.push(course);
    groups.set(key, group);
  }
  const sorted = [...groups.values()].sort((left, right) => left.year - right.year || left.term - right.term);
  return sorted.map((group, index) => ({ ...group, firstInYear: index === 0 || sorted[index - 1].year !== group.year }));
}

export function CurriculumScreen({ navigation }: MobileScreenProps) {
  const { copy, locale } = useAcademicCopy();
  const { formatNumber } = useLocale();
  const preview = isPreviewMode();
  const query = useAcademicQuery('academic.curriculum', () => academicApi.curriculum(), copy);
  const sectionsQuery = useAcademicQuery('academic.registrationSections', () => academicApi.registrationSections(), copy);
  const pull = usePullToRefresh(() => query.reload());
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [chainsOpen, setChainsOpen] = useState(false);
  const data = preview ? previewCurriculum : query.data ?? null;
  const courses = data?.courses ?? [];

  const statusByCode = useMemo(() => new Map(courses.map((course) => [course.code, course.status])), [courses]);
  const unlocksByCode = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const course of courses) {
      for (const code of course.prerequisites ?? []) {
        const list = map.get(code) ?? [];
        list.push(course.code);
        map.set(code, list);
      }
    }
    map.forEach((list) => list.sort());
    return map;
  }, [courses]);
  const prereqChains = useMemo(() => {
    const byCode = new Map(courses.map((course) => [course.code, course]));
    const paths: string[][] = [];
    const walk = (code: string, path: string[]) => {
      const next = (unlocksByCode.get(code) ?? []).filter(
        (dependent) => byCode.has(dependent) && !path.includes(dependent),
      );
      if (next.length === 0) {
        if (path.length > 1) paths.push(path);
        return;
      }
      next.forEach((dependent) => walk(dependent, [...path, dependent]));
    };
    const dependentCodes = new Set<string>();
    unlocksByCode.forEach((dependents) => dependents.forEach((code) => dependentCodes.add(code)));
    courses
      .filter(
        (course) =>
          !dependentCodes.has(course.code)
          && (unlocksByCode.get(course.code)?.length ?? 0) > 0,
      )
      .forEach((root) => walk(root.code, [root.code]));
    const isSubPath = (a: string[], b: string[]) =>
      a.length < b.length
      && Array.from({ length: b.length - a.length + 1 }, (_, i) => i).some(
        (offset) => a.every((code, j) => b[offset + j] === code),
      );
    return paths
      .filter((path) => !paths.some((other) => other !== path && isSubPath(path, other)))
      .sort((a, b) => b.length - a.length);
  }, [courses, unlocksByCode]);
  const isAvailable = (course: CurriculumCourse) =>
    course.status === 'NOT_STARTED' && (course.prerequisites ?? []).every((code) => statusByCode.get(code) === 'COMPLETED');

  const availableCourses = useMemo(() => courses.filter(isAvailable), [courses, statusByCode]);
  const completedCourses = useMemo(() => courses.filter((course) => course.status === 'COMPLETED'), [courses]);
  const inProgressCourses = useMemo(() => courses.filter((course) => course.status === 'IN_PROGRESS'), [courses]);
  const filteredCourses = useMemo(() => {
    if (filter === 'ALL') return courses;
    if (filter === 'AVAILABLE') return availableCourses;
    return courses.filter((course) => course.status === filter);
  }, [availableCourses, courses, filter]);
  const groups = useMemo(() => groupByTerm(filteredCourses), [filteredCourses]);
  const yearCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const group of groups) counts.set(group.year, (counts.get(group.year) ?? 0) + group.courses.length);
    return counts;
  }, [groups]);
  const openSectionCounts = useMemo(() => {
    const sections = sectionsQuery.data;
    if (!sections) return null;
    const counts = new Map<string, number>();
    for (const section of sections) {
      if (section.status === 'OPEN' && section.courseId) counts.set(section.courseId, (counts.get(section.courseId) ?? 0) + 1);
    }
    return counts;
  }, [sectionsQuery.data]);

  const earned = completedCourses.reduce((sum, course) => sum + course.credits, 0);
  const total = data?.curriculum.totalCredits ?? 0;
  const statusLabel = (status: CurriculumCourse['status']) => (status === 'COMPLETED' ? copy.completed : status === 'IN_PROGRESS' ? copy.inProgress : copy.notStarted);
  const gradeLabel = (course: CurriculumCourse) => (course.finalGrade === null || course.finalGrade === undefined
    ? null
    : `${formatNumber(course.finalGrade, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${course.letterGrade ? ` (${course.letterGrade})` : ''}`);
  const creditLabel = (course: CurriculumCourse) => fillCopy(countForm(course.credits, copy.creditsOne, copy.credits), { n: formatNumber(course.credits) });
  const filteredEmptyState = {
    ALL: { title: copy.filterAll, description: copy.curriculumAllEmpty },
    AVAILABLE: { title: copy.filterAvailable, description: copy.curriculumAvailableEmpty },
    COMPLETED: { title: copy.completed, description: copy.curriculumCompletedEmpty },
    IN_PROGRESS: { title: copy.inProgress, description: copy.curriculumInProgressEmpty },
    NOT_STARTED: { title: copy.notStarted, description: copy.curriculumNotStartedEmpty },
  }[filter];

  const requirementChips = (course: CurriculumCourse) => {
    const prerequisites = course.prerequisites ?? [];
    const unlocks = unlocksByCode.get(course.code) ?? [];
    if (prerequisites.length === 0 && unlocks.length === 0) return null;
    return <>
      {prerequisites.length > 0 ? (
        <View style={styles.chipRow}>
          <UiText variant="meta" tone="muted">{copy.prerequisiteLabel}</UiText>
          {prerequisites.map((code) => (
            <StatusPill key={code} label={statusByCode.get(code) === 'COMPLETED' ? `✓ ${code}` : code} tone={statusByCode.get(code) === 'COMPLETED' ? 'success' : 'neutral'} />
          ))}
        </View>
      ) : null}
      {unlocks.length > 0 ? (
        <View style={styles.chipRow}>
          <UiText variant="meta" tone="muted">{copy.unlocksLabel}</UiText>
          {unlocks.map((code) => <StatusPill key={code} label={code} tone="primary" />)}
        </View>
      ) : null}
    </>;
  };

  return (
    <AcademicShell
      title={copy.curriculumTitle}
      eyebrow={copy.curriculumEyebrow}
      subtitle={copy.curriculumDescription}
      loading={!preview && query.isLoading}
      error={preview ? null : query.error}
      warning={preview ? copy.previewNotice : query.warning}
      onRetry={() => void query.reload()}
      onRefresh={preview ? undefined : pull.onRefresh}
      refreshing={!preview && pull.refreshing}

      list={{ data: groupedRows(groups, (group) => group.key, (group) => group.courses, (item) => item.courseId), keyExtractor: (entry) => entry.key,
        renderItem: ({ item: entry }) => { const group = entry.group;
if (entry.kind === "header") return <GroupCard edge={entry.empty ? "single" : "start"} style={academicStyles.card}>
              {group.firstInYear ? <View style={styles.yearHeading}>
                <UiText accessibilityRole="header" variant="headlineSmall">{`${copy.yearPrefix} ${formatNumber(group.year)}`}</UiText>
                <UiText variant="meta" tone="muted">{`${formatNumber(yearCounts.get(group.year) ?? 0)} ${countForm(yearCounts.get(group.year) ?? 0, copy.courseWord, copy.coursesWord)}`}</UiText>
              </View> : null}
              <View style={styles.termHeading}>
                <IconChip icon="calendar-month-outline" size={32} />
                <UiText accessibilityRole="header" variant="headlineSmall" style={styles.termTitle}>
                  {`${copy.semesterPrefix} ${formatNumber(group.term)} - ${formatNumber(group.courses.length)} ${countForm(group.courses.length, copy.courseWord, copy.coursesWord)}`}
                </UiText>
              </View>
              </GroupCard>;
const course = entry.item;
const courseName = localizedName(course, locale, course.code);
const creditsLabel = creditLabel(course);
const prerequisiteLabel = course.prerequisites && course.prerequisites.length > 0
  ? `${copy.prerequisiteLabel} ${course.prerequisites.join(', ')}`
  : null;
const unlocksLabel = (unlocksByCode.get(course.code) ?? []).length > 0
  ? `${copy.unlocksLabel} ${(unlocksByCode.get(course.code) ?? []).join(', ')}`
  : null;
const requirementLabel = course.isMandatory ? copy.mandatory : copy.elective;
const completedGrade = gradeLabel(course);
const completedLabel = completedGrade ? `${statusLabel(course.status)} ${completedGrade}` : statusLabel(course.status);
const statusPillLabel = course.status === 'COMPLETED' ? completedLabel : course.status === 'IN_PROGRESS' ? copy.inProgress : isAvailable(course) ? copy.filterAvailable : copy.notStarted;
return <GroupCard edge={entry.last ? "end" : "middle"} style={academicStyles.card}>{(
                <View key={course.courseId} accessible accessibilityLabel={`${course.code} ${courseName}, ${statusLabel(course.status)}, ${creditsLabel}, ${requirementLabel}${prerequisiteLabel ? `, ${prerequisiteLabel}` : ''}${unlocksLabel ? `, ${unlocksLabel}` : ''}`}>
                  <Divider />
                  <View style={styles.courseRow}>
                    <IconChip icon="book-open-variant" size={32} tone="neutral" />
                    <View style={academicStyles.rowCopy}>
                      <StatusPill label={course.code} tone="primary" />
                      <UiText variant="bodyMedium">{courseName}</UiText>
                      <UiText variant="meta" tone="muted">{creditsLabel}</UiText>
                      {requirementChips(course)}
                    </View>
                    <View style={styles.coursePills}>
                      <StatusPill label={statusPillLabel} tone={course.status === 'COMPLETED' ? 'success' : course.status === 'IN_PROGRESS' ? 'info' : isAvailable(course) ? 'success' : 'neutral'} />
                      <StatusPill label={requirementLabel} tone="neutral" />
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
        <StatePanel kind="empty" title={copy.emptyCurriculum} description={copy.emptyCurriculumDescription} />
      ) : (<View>
          <View style={academicStyles.metrics}>
            <MetricCard icon="book-check-outline" label={copy.creditsEarned} value={formatNumber(earned)} style={academicStyles.metric} />
            <MetricCard icon="book-open-outline" label={copy.creditsLabel} value={formatNumber(total)} style={academicStyles.metric} />
          </View>
          <Card tone="primary" style={academicStyles.card}>
            <View style={styles.curriculumTitle}>
              <IconChip icon="school-outline" />
              <View style={styles.curriculumCopy}>
                <UiText variant="meta" tone="primary">{data.curriculum.code}</UiText>
                <UiText accessibilityRole="header" variant="headlineSmall">{localizedName(data.curriculum, locale, data.curriculum.code)}</UiText>
              </View>
            </View>
            <ProgressBar
              label={fillCopy(copy.curriculumProgress, { earned: formatNumber(earned), total: formatNumber(total) })}
              value={total > 0 ? (earned / total) * 100 : 0}
              tone="success"
            />
            <View style={styles.countRow}>
              {[
                { label: copy.completed, count: completedCourses.length },
                { label: copy.inProgress, count: inProgressCourses.length },
                { label: copy.filterAvailable, count: availableCourses.length },
              ].map((tile) => (
                <View key={tile.label} accessible accessibilityLabel={`${tile.label}: ${formatNumber(tile.count)}`} style={styles.countTile}>
                  <UiText variant="headlineSmall">{formatNumber(tile.count)}</UiText>
                  <UiText variant="meta" tone="muted">{tile.label}</UiText>
                </View>
              ))}
            </View>
          </Card>
          {prereqChains.length > 0 ? (
            <Card style={academicStyles.card}>
              <View style={styles.chainsHead}>
                <UiText accessibilityRole="header" variant="headlineSmall">{copy.chainsTitle}</UiText>
                <Button
                  label={chainsOpen
                    ? copy.chainsCollapse
                    : fillCopy(prereqChains.length === 1 ? copy.chainsExpandOne : copy.chainsExpand, { count: formatNumber(prereqChains.length) })}
                  variant="text"
                  onPress={() => setChainsOpen((open) => !open)}
                />
              </View>
              {chainsOpen ? <>
                <UiText variant="bodySmall" tone="muted">{copy.chainsDescription}</UiText>
                {prereqChains.map((chain) => (
                  <View key={chain.join('>')} accessible accessibilityLabel={chain.join(' → ')} style={styles.chainRow}>
                    {chain.map((code, step) => {
                      const status = statusByCode.get(code) ?? 'NOT_STARTED';
                      return (
                        <View key={`${chain.join('>')}-${code}-${step}`} style={styles.chainStep}>
                          {step > 0 ? <UiText variant="meta" tone="muted">→</UiText> : null}
                          <StatusPill
                            label={status === 'COMPLETED' ? `✓ ${code}` : code}
                            tone={status === 'COMPLETED' ? 'success' : status === 'IN_PROGRESS' ? 'info' : 'neutral'}
                          />
                        </View>
                      );
                    })}
                  </View>
                ))}
              </> : null}
            </Card>
          ) : null}
          {availableCourses.length > 0 && (filter === 'ALL' || filter === 'AVAILABLE') ? (
            <Card style={academicStyles.card}>
              <View style={styles.availableHead}>
                <UiText accessibilityRole="header" variant="headlineSmall">{copy.availableTitle}</UiText>
                <StatusPill label={formatNumber(availableCourses.length)} tone="primary" />
              </View>
              {availableCourses.map((course) => {
                const openCount = openSectionCounts?.get(course.courseId) ?? null;
                const openLabel = openCount === null
                  ? null
                  : openCount > 0
                    ? fillCopy(openCount === 1 ? copy.openSectionsOne : copy.openSections, { count: formatNumber(openCount) })
                    : copy.noOpenSection;
                return (
                  <View key={`available-${course.courseId}`} style={styles.availableRow}>
                    <View style={styles.availableCopy}>
                      <View style={styles.chipRow}>
                        <StatusPill label={course.code} tone="primary" />
                        <UiText variant="meta" tone="muted">{creditLabel(course)}</UiText>
                        <UiText variant="meta" tone="muted">{course.isMandatory ? copy.mandatory : copy.elective}</UiText>
                      </View>
                      <UiText variant="bodyMedium">{localizedName(course, locale, course.code)}</UiText>
                      {requirementChips(course)}
                    </View>
                    <View style={styles.availableActions}>
                      {openLabel ? <UiText variant="meta" tone="muted">{openLabel}</UiText> : null}
                      {openCount !== null && openCount > 0 ? (
                        <Button label={copy.registerCta} accessibilityLabel={`${copy.registerCta}: ${course.code}`} variant="secondary" onPress={() => navigation.navigate('registration')} />
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </Card>
          ) : null}
          <ScreenSpacer />
          <ChoiceField
            label={copy.filterStatus}
            value={filter}
            onChange={(value) => setFilter(value as StatusFilter)}
            display="sheet"
            options={[
              { value: 'ALL', label: copy.filterAll },
              { value: 'AVAILABLE', label: copy.filterAvailable },
              { value: 'COMPLETED', label: copy.completed },
              { value: 'IN_PROGRESS', label: copy.inProgress },
              { value: 'NOT_STARTED', label: copy.notStarted },
            ]}
          />
          {groups.length === 0 ? <StatePanel kind="empty" title={filteredEmptyState.title} description={filteredEmptyState.description} /> : null}
          </View>)}</AcademicShell>
  );
}

const styles = StyleSheet.create({
  curriculumTitle: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  curriculumCopy: { flex: 1, gap: 4, minWidth: 0 },
  countRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginTop: tokens.spacing.sm },
  countTile: { alignItems: 'center', borderRadius: tokens.radii.control, flexBasis: 90, flexGrow: 1, gap: 2, paddingVertical: tokens.spacing.xs },
  yearHeading: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.md },
  termHeading: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 8 },
  termTitle: { flex: 1, minWidth: 0 },
  chainsHead: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between', marginBottom: tokens.spacing.xs },
  chainRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs, marginTop: tokens.spacing.sm },
  chainStep: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.xs },
  availableHead: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginBottom: tokens.spacing.xs },
  availableRow: { borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, paddingVertical: tokens.spacing.sm },
  availableCopy: { flex: 1, gap: 4, minWidth: 160 },
  availableActions: { alignItems: 'flex-start', gap: tokens.spacing.xs },
  chipRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  courseRow: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
  coursePills: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
