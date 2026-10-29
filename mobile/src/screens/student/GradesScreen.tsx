import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Divider, MetricCard, ScreenSpacer, SectionHeading, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { useLocale } from '../../i18n/locale-provider';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi, type AcademicGradeRecord } from '../academic/academic-api';
import { previewGrades } from '../academic/academic-preview';
import { computeAverage10, computeGpa4, publishedOnly } from '../academic/gpa';
import {
  AcademicShell,
  GradeScale,
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

function letterTone(letter: string | null | undefined): 'success' | 'warning' | 'error' | 'neutral' {
  if (letter === 'A+' || letter === 'A' || letter === 'B+' || letter === 'B') return 'success';
  if (letter === 'D' || letter === 'D+' || letter === 'F') return 'error';
  return letter ? 'warning' : 'neutral';
}

/** Published grades by term. The cumulative record is the transcript, never mixed in here. */
export function GradesScreen({ navigation }: MobileScreenProps) {
  const { copy, locale } = useAcademicCopy();
  const { formatNumber } = useLocale();
  const gpa = useGpaFormat();
  const preview = isPreviewMode();
  const query = useAcademicQuery('academic.grades', () => academicApi.grades(), copy);
  const [term, setTerm] = useState('');

  const records = useMemo(() => publishedOnly(preview ? previewGrades : query.data ?? []), [preview, query.data]);
  const options = useMemo(() => {
    const seen = new Map<string, string>();
    for (const record of records) {
      const entry = termOf(record, locale);
      if (entry && !seen.has(entry.value)) seen.set(entry.value, entry.label);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [records, locale]);
  const visible = records.filter((record) => !term || record.semesterId === term);
  const credits = visible.reduce((sum, record) => sum + (record.credits ?? 0), 0);
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
    <AcademicShell
      title={copy.gradesTitle}
      loading={!preview && query.isLoading}
      error={preview ? null : query.error}
      warning={preview ? null : query.warning}
      onRetry={() => void query.reload()}
    >
      <TermField options={options} value={term} onChange={setTerm} />
      <View style={academicStyles.metrics}>
        <MetricCard icon="chart-donut" label={term ? copy.termGpa : copy.listedGpa} value={gpa(computeGpa4(visible))} style={academicStyles.metric} />
        <MetricCard icon="chart-line" label={copy.average10} value={formatNumber(computeAverage10(visible), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} style={academicStyles.metric} />
        <MetricCard icon="book-check-outline" label={copy.records} value={formatNumber(visible.length)} style={academicStyles.metric} />
        <MetricCard icon="book-open-outline" label={copy.creditsAttempted} value={formatNumber(credits)} style={academicStyles.metric} />
      </View>
      <SectionHeading title={copy.publishedGrades} />
      {visible.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptyGrades} />
      ) : (
        grouped.map(([groupKey, group]) => (
          <Card key={groupKey} style={academicStyles.card}>
            <UiText accessibilityRole="header" variant="headlineSmall" style={styles.termTitle}>{group.label}</UiText>
            {group.records.map((record, index) => (
              <View
                key={record.id}
                accessible
                accessibilityLabel={`${record.courseCode} ${record.courseName}, ${record.finalGrade ?? ''} ${record.letterGrade ?? ''}`}
              >
                {index > 0 ? <Divider /> : null}
                <View style={styles.gradeRow}>
                  <View style={styles.gradeCopy}>
                    <StatusPill label={record.courseCode} tone="primary" />
                    <UiText variant="bodyMedium">{record.courseName}</UiText>
                    <UiText variant="meta" tone="muted">{fillCopy(copy.credits, { n: record.credits ?? 0 })}</UiText>
                    {record.processScore != null || record.finalExamScore != null ? (
                      <UiText variant="meta" tone="muted">
                        {copy.processScore} {formatNumber(record.processScore, { maximumFractionDigits: 1 })} · {copy.finalExam} {formatNumber(record.finalExamScore, { maximumFractionDigits: 1 })}
                      </UiText>
                    ) : null}
                  </View>
                  <View style={styles.gradeResult}>
                    {record.finalGrade != null ? (
                      <UiText variant="headlineSmall" tone="primary">{formatNumber(record.finalGrade, { maximumFractionDigits: 1 })}</UiText>
                    ) : null}
                    <StatusPill
                      label={record.letterGrade ?? copy.gradeStatus[record.gradeStatus ?? 'NOT_GRADED'] ?? copy.noGrade}
                      tone={letterTone(record.letterGrade)}
                    />
                  </View>
                </View>
              </View>
            ))}
          </Card>
        ))
      )}
      <ScreenSpacer />
      <GradeScale />
      <ScreenSpacer />
      <Button label={copy.openTranscript} onPress={() => openRoute(navigation, 'transcript')} variant="secondary" />
    </AcademicShell>
  );
}

const styles = StyleSheet.create({
  termTitle: { marginBottom: 4 },
  gradeRow: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 8 },
  gradeCopy: { flex: 1, gap: 4, minWidth: 160 },
  gradeResult: { alignItems: 'flex-start', gap: 4, maxWidth: '100%' },
});
