import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Divider, IconChip, MetricCard, ProgressBar, ScreenSpacer, SectionHeading, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { ChartSummary } from '../../components/ui/chart-summary';
import { useLocale } from '../../i18n/locale-provider';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi } from './academic-api';
import { cumulativeTrend, isPublishedGrade, parseTranscript, type TranscriptTerm } from './gpa';
import {
  AcademicShell,
  GradeScale,
  TermField,
  academicStyles,
  isPreviewMode,
  useAcademicCopy,
  useAcademicQuery,
  useGpaFormat,
} from './academic-ui';

function TermCard({ term }: { term: TranscriptTerm }) {
  const { copy } = useAcademicCopy();
  const { formatNumber } = useLocale();
  const gpa = useGpaFormat();
  return (
    <Card style={academicStyles.card}>
      <View style={styles.termHeader}>
        <IconChip icon="calendar-month-outline" />
        <UiText accessibilityRole="header" variant="headlineSmall" style={styles.termName}>{term.name}</UiText>
      </View>
      <UiText variant="bodySmall" tone="muted">
        {fillCopy(copy.termResult, { gpa: gpa(term.gpa), earned: formatNumber(term.creditsEarned), attempted: formatNumber(term.creditsAttempted) })}
      </UiText>
      <ProgressBar
        label={`${copy.creditsEarned} / ${copy.creditsAttempted}`}
        value={term.creditsAttempted > 0 ? (term.creditsEarned / term.creditsAttempted) * 100 : 0}
        tone="success"
      />
      {term.records.map((record) => {
        const published = isPublishedGrade(record);
        const result = published && record.finalGrade != null
          ? `${formatNumber(record.finalGrade, { maximumFractionDigits: 1 })} · ${record.letterGrade ?? '—'}`
          : copy.gradeStatus[record.gradeStatus ?? 'NOT_GRADED'] ?? copy.noGrade;
        return (
          <View key={record.id} accessible accessibilityLabel={`${record.courseCode} ${record.courseName}, ${result}`}>
            <Divider />
            <View style={academicStyles.row}>
              <View style={academicStyles.rowCopy}>
                <StatusPill label={record.courseCode} tone="primary" />
                <UiText variant="bodyMedium">{record.courseName}</UiText>
                <UiText variant="meta" tone="muted">{fillCopy(copy.credits, { n: record.credits })}</UiText>
              </View>
              {published && record.finalGrade != null ? (
                <View style={styles.gradeResult}>
                  <UiText variant="headlineSmall" tone="primary">{formatNumber(record.finalGrade, { maximumFractionDigits: 1 })}</UiText>
                  <StatusPill label={record.letterGrade ?? '—'} tone="success" />
                </View>
              ) : <StatusPill label={result} tone="warning" />}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

/** Cumulative transcript only; current-term grades live on the grades screen. */
export function TranscriptScreen(_props: MobileScreenProps) {
  const { copy, locale } = useAcademicCopy();
  const { formatNumber } = useLocale();
  const gpa = useGpaFormat();
  const preview = isPreviewMode();
  const query = useAcademicQuery('academic.transcript', () => academicApi.transcript(), copy);
  const [term, setTerm] = useState('');

  const model = useMemo(() => (query.data === undefined ? null : parseTranscript(query.data, locale)), [query.data, locale]);
  const malformed = !preview && query.data !== undefined && model === null;
  const visibleTerms = model ? model.terms.filter((entry) => !term || entry.semesterId === term) : [];
  const trend = model ? cumulativeTrend(model.terms, model.cumulativeGpa, locale === 'vi' ? 'HK' : 'T') : [];

  return (
    <AcademicShell
      title={copy.transcriptTitle}
      loading={!preview && query.isLoading}
      error={preview ? null : malformed ? copy.generic : query.error}
      warning={preview ? null : query.warning}
      onRetry={() => void query.reload()}
    >
      {!model || model.terms.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptyTranscript} />
      ) : (
        <View>
          <View style={academicStyles.metrics}>
            <MetricCard icon="chart-donut" label={copy.cumulativeGpa} value={gpa(model.cumulativeGpa)} style={academicStyles.metric} />
            <MetricCard icon="book-check-outline" label={copy.creditsEarned} value={formatNumber(model.totalCreditsEarned)} style={academicStyles.metric} />
            <MetricCard icon="book-open-outline" label={copy.creditsAttempted} value={formatNumber(model.totalCreditsAttempted)} style={academicStyles.metric} />
          </View>
          {model.basisNote ? <UiText variant="bodySmall" tone="muted">{model.basisNote}</UiText> : null}
          <ScreenSpacer />
          <ChartSummary title={copy.gpaTrend} series={trend} />
          <ScreenSpacer />
          <TermField options={model.terms.map((entry) => ({ value: entry.semesterId, label: entry.name }))} value={term} onChange={setTerm} />
          {visibleTerms.map((entry) => <TermCard key={entry.semesterId} term={entry} />)}
          <SectionHeading title={copy.scaleTitle} />
          <GradeScale />
          <ScreenSpacer />
          <UiText variant="bodySmall" tone="muted">{copy.printOnWeb}</UiText>
        </View>
      )}
    </AcademicShell>
  );
}

const styles = StyleSheet.create({
  termHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 4 },
  termName: { flex: 1, minWidth: 0 },
  gradeResult: { alignItems: 'flex-start', gap: 4, maxWidth: '100%' },
});
