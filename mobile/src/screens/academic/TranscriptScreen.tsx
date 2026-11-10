import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Divider, IconChip, MetricCard, ScreenSpacer, SectionHeading, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { minTapTarget } from '../../design/tokens';
import { ChartSummary } from '../../components/ui/chart-summary';
import { groupedRows, type GroupedRow } from '../../components/perf/grouped-rows';
import { GroupCard } from '../../components/perf/group-card';
import { useLocale } from '../../i18n/locale-provider';
import { countForm } from '../../i18n/locale';
import { fillCopy } from '../../i18n/academic-messages';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi } from './academic-api';
import {
  computeAverage10,
  cumulativeTrend,
  gradeDistribution,
  isPublishedGrade,
  letterTone,
  parseTranscript,
  resolveGradePoint,
  transcriptCourseCounts,
  type TranscriptRecord,
  type TranscriptTerm,
} from './gpa';
import { GradeDetailSheet } from './GradeDetailSheet';
import {
  AcademicShell,
  GradeScale,
  TermField,
  academicStyles,
  enrollmentStatusTone,
  isPreviewMode,
  openRoute,
  useAcademicCopy,
  useAcademicQuery,
  useGpaFormat,
} from './academic-ui';

interface SelectedRecord {
  record: TranscriptRecord;
  semesterLabel: string;
}

function TermCard({ entry, onSelect }: { entry: GroupedRow<TranscriptTerm, TranscriptRecord>; onSelect: (record: TranscriptRecord, semesterLabel: string) => void }) {
  const term = entry.group;
  const { copy } = useAcademicCopy();
  const { formatNumber } = useLocale();
  const gpa = useGpaFormat();
  if (entry.kind === 'header') return (
    <GroupCard edge={entry.empty ? 'single' : 'start'} style={academicStyles.card}>
      <View style={styles.termHeader}>
        <IconChip icon="calendar-month-outline" />
        <UiText accessibilityRole="header" variant="headlineSmall" style={styles.termName}>{term.name}</UiText>
      </View>
      <UiText variant="bodySmall" tone="muted">{copy.clickToViewDetail}</UiText>
      <UiText variant="bodySmall" tone="muted">
        {fillCopy(copy.termSummary, {
          count: `${formatNumber(term.records.length)} ${countForm(term.records.length, copy.courseWord, copy.coursesWord)}`,
          credits: formatNumber(term.creditsAttempted),
          unit: copy.creditsAttempted,
          label: copy.gradePointLabel,
          gpa: gpa(term.gpa),
        })}
      </UiText>
    </GroupCard>
  );
  const record = entry.item;
        const published = isPublishedGrade(record);
        const result = published && record.finalGrade != null
          ? `${formatNumber(record.finalGrade, { maximumFractionDigits: 1 })} · ${record.letterGrade ?? '—'}`
          : published && record.letterGrade
            ? record.letterGrade
            : copy.gradeStatus[record.gradeStatus ?? 'NOT_GRADED'] ?? copy.noGrade;
        const creditsLabel = fillCopy(countForm(record.credits, copy.creditsOne, copy.credits), { n: formatNumber(record.credits) });
        const point = resolveGradePoint(record);
        const enrollmentLabel = copy.status[record.enrollmentStatus ?? 'UNKNOWN'] ?? copy.status.UNKNOWN;
        const gradeStatusLabel = copy.gradeStatus[record.gradeStatus ?? 'NOT_GRADED'] ?? copy.noGrade;
        const openLabel = fillCopy(copy.openBreakdown, { courseCode: record.courseCode, courseName: record.courseName });
        return (
          <GroupCard edge={entry.last ? 'end' : 'middle'} style={academicStyles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${openLabel}, ${record.courseName}, ${creditsLabel}, ${result}, ${enrollmentLabel}, ${gradeStatusLabel}`}
            onPress={() => onSelect(record, term.name)}
            style={styles.rowPress}
          >
            <Divider />
            <View style={academicStyles.row}>
              <View style={academicStyles.rowCopy}>
                <StatusPill label={record.courseCode} tone="primary" />
                <UiText variant="bodyMedium">{record.courseName}</UiText>
                {record.sectionCode ? <UiText variant="meta" tone="muted">{record.sectionCode}</UiText> : null}
                <UiText variant="meta" tone="muted">{creditsLabel}</UiText>
                {point !== null ? <UiText variant="meta" tone="muted">{`${copy.transcriptPoints}: ${formatNumber(point, { maximumFractionDigits: 1 })}`}</UiText> : null}
              </View>
              <View style={styles.gradeResult}>
                {published && record.finalGrade != null ? (
                  <UiText variant="headlineSmall" tone="primary">{formatNumber(record.finalGrade, { maximumFractionDigits: 1 })}</UiText>
                ) : null}
                {published ? (
                  <StatusPill label={record.letterGrade ?? '—'} tone={letterTone(record.letterGrade)} />
                ) : null}
                <StatusPill label={enrollmentLabel} tone={enrollmentStatusTone(record.enrollmentStatus ?? '')} />
                <StatusPill label={gradeStatusLabel} tone={record.gradeStatus === 'APPEALED' ? 'warning' : 'neutral'} />
              </View>
            </View>
          </Pressable>
          </GroupCard>
        );
}

/** Cumulative transcript only; current-term grades live on the grades screen. */
export function TranscriptScreen({ navigation }: MobileScreenProps) {
  const { copy, locale } = useAcademicCopy();
  const { formatNumber } = useLocale();
  const gpa = useGpaFormat();
  const preview = isPreviewMode();
  const query = useAcademicQuery('academic.transcript', () => academicApi.transcript(), copy);
  const curriculumQuery = useAcademicQuery('academic.curriculum', () => academicApi.curriculum(), copy);
  const pull = usePullToRefresh(() => query.reload());
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<SelectedRecord | null>(null);

  const model = useMemo(() => (query.data === undefined ? null : parseTranscript(query.data, locale)), [query.data, locale]);
  const curriculum = curriculumQuery.data && Array.isArray(curriculumQuery.data.courses) ? curriculumQuery.data : null;
  const malformed = !preview && query.data !== undefined && model === null;
  const visibleTerms = model ? model.terms.filter((entry) => !term || entry.semesterId === term) : [];
  const trend = model ? cumulativeTrend(model.terms, model.cumulativeGpa, copy.trendTermPrefix) : [];
  const tenScaleTrend = model
    ? [...model.terms]
      .reverse()
      .filter((term) => term.records.some((record) => typeof record.finalGrade === 'number'))
      .map((term, index) => {
        const graded = term.records.filter((record) => typeof record.finalGrade === 'number');
        const average = computeAverage10(graded) ?? 0;
        return { label: `${copy.trendTermPrefix}${index + 1}`, value: Math.round(average * 10) / 10 };
      })
    : [];
  const distribution = model ? gradeDistribution(visibleTerms) : [];
  const counts = model ? transcriptCourseCounts(model.terms, curriculum?.courses) : { completedCourses: 0, inProgressCourses: 0 };
  const requiredCredits = curriculum?.curriculum?.totalCredits;

  return (
    <>
    <AcademicShell
      title={copy.transcriptTitle}
      eyebrow={copy.transcriptEyebrow}
      subtitle={copy.transcriptDescription}
      loading={!preview && query.isLoading}
      loadingLabel={copy.loadingTranscript}
      errorTitle={copy.transcriptUnavailable}
      error={preview ? null : malformed ? copy.generic : query.error}
      warning={preview ? null : query.warning}
      onRetry={() => void query.reload()}
      onRefresh={preview ? undefined : pull.onRefresh}
      refreshing={!preview && pull.refreshing}

      list={{ data: groupedRows(visibleTerms, (entry) => entry.semesterId, (entry) => entry.records, (record) => record.id), keyExtractor: (entry) => entry.key,
        renderItem: ({ item: entry }) => <TermCard entry={entry} onSelect={(record, semesterLabel) => setSelected({ record, semesterLabel })} />,
        footer: <>{!model || model.terms.length === 0 ? null : (<View>
          <SectionHeading title={copy.scaleTitle} />
          <GradeScale />
          <ScreenSpacer />
          <UiText variant="bodySmall" tone="muted">{copy.printOnWeb}</UiText>
        </View>)}
    </>,
      }}
    >
      {!model || model.terms.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptyTranscript} description={copy.emptyTranscriptDescription} actionLabel={copy.openGrades} onAction={() => openRoute(navigation, 'grades')} />
      ) : (<View>
          <View style={academicStyles.metrics}>
            <MetricCard icon="chart-donut" label={copy.cumulativeGpa} value={gpa(model.cumulativeGpa)} style={academicStyles.metric} />
            <MetricCard
              icon="book-check-outline"
              label={copy.creditsEarned}
              value={requiredCredits != null ? `${formatNumber(model.totalCreditsEarned)} / ${formatNumber(requiredCredits)}` : formatNumber(model.totalCreditsEarned)}
              style={academicStyles.metric}
            />
            <MetricCard icon="school-outline" label={copy.completedCourses} value={formatNumber(counts.completedCourses)} style={academicStyles.metric} />
            <MetricCard icon="file-document-outline" label={copy.inProgressCourses} value={formatNumber(counts.inProgressCourses)} style={academicStyles.metric} />
          </View>
          {model.basisNote ? <UiText variant="bodySmall" tone="muted">{model.basisNote}</UiText> : null}
          <ScreenSpacer />
          <ChartSummary title={copy.gpaTrend} series={trend} />
          <ScreenSpacer />
          <ChartSummary title={copy.avgTenScale} series={tenScaleTrend} />
          <ScreenSpacer />
          <ChartSummary title={copy.distribution} series={distribution.map((bucket) => ({ label: bucket.letter, value: bucket.count }))} />
          <ScreenSpacer />
          <TermField options={model.terms.map((entry) => ({ value: entry.semesterId, label: entry.name }))} value={term} onChange={setTerm} />
          </View>)}</AcademicShell>
    <GradeDetailSheet
      record={selected?.record ?? null}
      semesterLabel={selected?.semesterLabel}
      onClose={() => setSelected(null)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  termHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 4 },
  termName: { flex: 1, minWidth: 0 },
  rowPress: { minHeight: minTapTarget },
  gradeResult: { alignItems: 'flex-start', gap: 4, maxWidth: '100%' },
});
