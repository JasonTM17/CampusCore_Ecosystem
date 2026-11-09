import { groupedRows } from '../../components/perf/grouped-rows';
import { GroupCard } from '../../components/perf/group-card';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Divider, MetricCard, ScreenSpacer, SectionHeading, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { minTapTarget } from '../../design/tokens';
import { useLocale } from '../../i18n/locale-provider';
import { countForm } from '../../i18n/locale';
import { fillCopy } from '../../i18n/academic-messages';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi, type AcademicGradeRecord } from '../academic/academic-api';
import { previewGrades } from '../academic/academic-preview';
import { letterTone, parseTranscript, publishedOnly, semesterProgressCards, summarizeBestAttempts } from '../academic/gpa';
import { localizedName } from '../academic/academic-model';
import { GradeDetailSheet } from '../academic/GradeDetailSheet';
import {
  AcademicShell,
  TermField,
  academicStyles,
  isPreviewMode,
  openRoute,
  useAcademicCopy,
  useAcademicQuery,
  useGpaFormat,
} from '../academic/academic-ui';

function termOf(record: AcademicGradeRecord, locale: 'vi' | 'en'): { value: string; label: string } | null {
  if (!record.semesterId) return null;
  const label = (locale === 'vi' ? record.semesterNameVi ?? record.semesterNameEn : record.semesterNameEn ?? record.semesterNameVi) ?? record.semester ?? record.semesterId;
  return { value: record.semesterId, label };
}

/** Published grades by term. The cumulative record is the transcript, never mixed in here. */
export function GradesScreen({ navigation }: MobileScreenProps) {
  const { copy, locale } = useAcademicCopy();
  const { formatNumber } = useLocale();
  const gpa = useGpaFormat();
  const preview = isPreviewMode();
  const query = useAcademicQuery('academic.grades', () => academicApi.grades(), copy);
  const transcriptQuery = useAcademicQuery('academic.transcript', () => academicApi.transcript(), copy);
  const semesters = useAcademicQuery('academic.semesters', () => academicApi.semesters(), copy);
  const pull = usePullToRefresh(() => query.reload());
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<AcademicGradeRecord | null>(null);

  const records = useMemo(() => publishedOnly(preview ? previewGrades : query.data ?? []), [preview, query.data]);
  const options = useMemo(() => {
    const seen = new Map<string, string>();
    for (const semester of semesters.data ?? []) {
      seen.set(semester.id, localizedName(semester, locale, semester.name ?? semester.id));
    }
    for (const record of records) {
      const entry = termOf(record, locale);
      if (entry && !seen.has(entry.value)) seen.set(entry.value, entry.label);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [records, semesters.data, locale]);
  const visible = records.filter((record) => !term || record.semesterId === term);
  const summary = summarizeBestAttempts(visible);
  const gradedCount = visible.filter((record) => Boolean(record.letterGrade)).length;
  const progressCards = useMemo(() => {
    const model = preview ? null : parseTranscript(transcriptQuery.data, locale);
    return model ? semesterProgressCards(model.terms) : [];
  }, [preview, transcriptQuery.data, locale]);
  const grouped = useMemo(() => {
    const groups = new Map<string, { label: string; records: AcademicGradeRecord[] }>();
    for (const record of visible) {
      const semester = termOf(record, locale);
      const key = semester?.value ?? record.semester ?? copy.publishedGrades;
      const group = groups.get(key) ?? { label: semester?.label ?? record.semester ?? copy.publishedGrades, records: [] };
      group.records.push(record);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [visible, locale, copy.publishedGrades]);

  return (
    <>
    <AcademicShell
      title={copy.gradesTitle}
      eyebrow={copy.gradesEyebrow}
      loading={!preview && query.isLoading}
      loadingLabel={copy.loadingGrades}
      errorTitle={copy.gradesUnavailable}
      error={preview ? null : query.error}
      warning={preview ? null : query.warning}
      onRetry={() => void query.reload()}
      onRefresh={preview ? undefined : pull.onRefresh}
      refreshing={!preview && pull.refreshing}

      list={{ data: groupedRows(grouped, (group) => group[0], (group) => group[1].records, (item) => item.id), keyExtractor: (entry) => entry.key,
        renderItem: ({ item: entry }) => { const item = entry.group;  const [groupKey, group] = item;
if (entry.kind === "header") return <GroupCard edge={entry.empty ? "single" : "start"} style={academicStyles.card}>
            <UiText accessibilityRole="header" variant="headlineSmall" style={styles.termTitle}>{group.label}</UiText>
            <UiText variant="meta" tone="muted">{copy.componentSummary}</UiText>
            <UiText variant="meta" tone="muted">{`${formatNumber(group.records.length)} ${countForm(group.records.length, copy.courseWord, copy.coursesWord)} - ${formatNumber(group.records.reduce((sum, record) => sum + (record.credits ?? 0), 0))} ${copy.creditsWord}`}</UiText>
            </GroupCard>;
const record = entry.item; const index = entry.index;
const courseName = localizedName({ name: record.courseName, nameEn: record.courseNameEn, nameVi: record.courseNameVi }, locale) || record.courseName;
const creditsLabel = fillCopy(countForm(record.credits ?? 0, copy.creditsOne, copy.credits), { n: record.credits ?? 0 });
const componentScores = record.processScore != null || record.finalExamScore != null
  ? `${copy.processScore} ${formatNumber(record.processScore, { maximumFractionDigits: 1 })} · ${copy.finalExam} ${formatNumber(record.finalExamScore, { maximumFractionDigits: 1 })}`
  : null;
const appealedLabel = record.gradeStatus === 'APPEALED' ? `, ${copy.gradeStatus.APPEALED ?? 'APPEALED'}` : '';
const openLabel = fillCopy(copy.openBreakdown, { courseCode: record.courseCode, courseName });
return <GroupCard edge={entry.last ? "end" : "middle"} style={academicStyles.card}>{(
              <Pressable
                key={record.id}
                accessibilityRole="button"
                accessibilityLabel={`${openLabel}, ${record.finalGrade ?? ''} ${record.letterGrade ?? ''}, ${creditsLabel}${componentScores ? `, ${componentScores}` : ''}${appealedLabel}`}
                onPress={() => setSelected(record)}
                style={styles.rowPress}
              >
                {index > 0 ? <Divider /> : null}
                <View style={styles.gradeRow}>
                  <View style={styles.gradeCopy}>
                    <StatusPill label={record.courseCode} tone="primary" />
                    <UiText variant="bodyMedium">{courseName}</UiText>
                    <UiText variant="meta" tone="muted">{creditsLabel}</UiText>
                    {componentScores ? <UiText variant="meta" tone="muted">{componentScores}</UiText> : null}
                  </View>
                  <View style={styles.gradeResult}>
                    {record.finalGrade != null ? (
                      <UiText variant="headlineSmall" tone="primary">{formatNumber(record.finalGrade, { maximumFractionDigits: 1 })}</UiText>
                    ) : null}
                    <StatusPill
                      label={record.letterGrade ?? copy.gradeStatus[record.gradeStatus ?? 'NOT_GRADED'] ?? copy.noGrade}
                      tone={letterTone(record.letterGrade)}
                    />
                    {record.gradeStatus === 'APPEALED' ? (
                      <StatusPill label={copy.gradeStatus.APPEALED ?? 'APPEALED'} tone="warning" />
                    ) : null}
                  </View>
                </View>
              </Pressable>
            )}</GroupCard>; },
        footer: visible.length === 0 ? null : <>
      <ScreenSpacer />
      <Button label={copy.openTranscript} onPress={() => openRoute(navigation, 'transcript')} variant="secondary" />
    </>,
      }}
    >
      <TermField options={options} value={term} onChange={setTerm} />
      <View style={academicStyles.metrics}>
        <MetricCard icon="chart-donut" label={term ? copy.termGpa : copy.listedGpa} value={gpa(summary.gpa)} style={academicStyles.metric} />
        <MetricCard icon="book-check-outline" label={copy.completedCredits} value={formatNumber(summary.completedCredits)} style={academicStyles.metric} />
        <MetricCard icon="book-open-outline" label={copy.gradedCourses} value={`${formatNumber(gradedCount)}/${formatNumber(visible.length)}`} style={academicStyles.metric} />
      </View>
      {progressCards.length > 0 ? (
        <View accessibilityLabel={copy.progressStripAriaLabel} style={styles.progressSection}>
          <SectionHeading title={copy.progressStripTitle} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.progressRow}>
            {progressCards.map((card) => (
              <Card key={card.semesterId} style={styles.progressCard}>
                <UiText variant="label" numberOfLines={1} style={styles.progressTerm}>{card.name}</UiText>
                <View style={styles.progressValues}>
                  <UiText variant="headlineSmall" style={styles.progressGpa}>
                    {card.gpa === null ? '—' : gpa(card.gpa)}
                  </UiText>
                  <UiText variant="meta" tone="muted">
                    {`${formatNumber(card.creditsEarned)} ${copy.creditsWord}`}
                  </UiText>
                </View>
                <UiText variant="meta" tone="muted" style={styles.progressGpaLabel}>{copy.gradePointLabel}</UiText>
              </Card>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <SectionHeading title={copy.publishedGrades} />
      {visible.length === 0 ? (
        <StatePanel
          kind="empty"
          title={copy.emptyGrades}
          description={copy.emptyGradesDescription}
          actionLabel={copy.openTranscript}
          onAction={() => openRoute(navigation, 'transcript')}
        />
      ) : (null)}</AcademicShell>
      <GradeDetailSheet record={selected} onClose={() => setSelected(null)} />
      </>
  );
}

const styles = StyleSheet.create({
  progressSection: { gap: 8, marginBottom: 8 },
  progressRow: { gap: 12, paddingVertical: 4 },
  progressCard: { gap: 6, minWidth: 148, paddingHorizontal: 12, paddingVertical: 10 },
  progressTerm: { maxWidth: 148 },
  progressValues: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
  progressGpa: { fontVariant: ['tabular-nums'] },
  progressGpaLabel: { letterSpacing: 0.8, textTransform: 'uppercase' },
  termTitle: { marginBottom: 4 },
  rowPress: { minHeight: minTapTarget },
  gradeRow: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 8 },
  gradeCopy: { flex: 1, gap: 4, minWidth: 160 },
  gradeResult: { alignItems: 'flex-start', gap: 4, maxWidth: '100%' },
});
