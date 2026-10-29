import { cardRows, contentRows, renderVirtualRow } from '../../components/perf/virtual-rows';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Card, Divider, IconChip, MetricCard, ProgressBar, ScreenSpacer, SectionHeading, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/choice-field';
import { useLocale } from '../../i18n/locale-provider';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi, type AttendanceSummaryRow } from '../academic/academic-api';
import { localizedName, termOptions } from '../academic/academic-model';
import { previewAttendance } from '../academic/academic-preview';
import { AcademicShell, TermField, academicStyles, isPreviewMode, useAcademicCopy, useAcademicQuery } from '../academic/academic-ui';
import { CheckinEntryCard } from '../attendance-checkin/CheckinEntryCard';

/** Attendance rate weighted by sessions, from the server per-course rates. */
export function overallRate(rows: readonly AttendanceSummaryRow[]): number {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  if (total === 0) return 0;
  return Math.round(rows.reduce((sum, row) => sum + row.attendanceRate * row.total, 0) / total);
}

const tone = (status: string) => (status === 'PRESENT' ? 'success' : status === 'ABSENT' ? 'error' : 'warning');
const rateTone = (rate: number) => (rate >= 80 ? 'success' : rate >= 60 ? 'warning' : 'error');

export function AttendanceScreen({ navigation }: MobileScreenProps) {
  const { copy, locale } = useAcademicCopy();
  const { formatDate, formatNumber } = useLocale();
  const preview = isPreviewMode();
  const [term, setTerm] = useState('');
  const [sectionId, setSectionId] = useState('');
  const semestersQuery = useAcademicQuery('academic.semesters', () => academicApi.semesters(), copy);
  const summaryQuery = useAcademicQuery(`academic.attendance.summary.${term}`, () => academicApi.attendanceSummary(term || null), copy);
  const recordsQuery = useAcademicQuery(`academic.attendance.records.${term}`, () => academicApi.attendanceRecords(term || null), copy);

  const summary = useMemo(() => (preview ? previewAttendance : summaryQuery.data ?? []), [preview, summaryQuery.data]);
  const records = preview ? [] : recordsQuery.data ?? [];
  const options = termOptions([], preview ? [] : semestersQuery.data ?? [], locale);
  const rows = summary.filter((row) => !sectionId || row.sectionId === sectionId);
  const visibleRecords = records
    .filter((record) => !sectionId || record.sectionId === sectionId)
    .sort((left, right) => right.date.localeCompare(left.date));
  const sum = (key: 'present' | 'absent' | 'late' | 'excused') => rows.reduce((total, row) => total + row[key], 0);

  return (
    <AcademicShell
      title={copy.attendanceTitle}
      loading={!preview && summaryQuery.isLoading}
      error={preview ? null : summaryQuery.error}
      warning={preview ? null : summaryQuery.warning}
      onRetry={() => { void summaryQuery.reload(); void recordsQuery.reload(); }}

      list={{ data: [...((summary.length === 0) ? [] : contentRows("section-1", rows, (item, index) => String(item.sectionId), (row) => (
            <Card key={row.sectionId} style={academicStyles.card}>
              <View style={styles.courseHeader}>
                <IconChip icon="book-open-variant" size={32} />
                <View style={academicStyles.rowCopy}>
                  <StatusPill label={row.courseCode} tone="primary" />
                  <UiText variant="bodyMedium">{localizedName({ name: row.courseName, nameEn: row.courseNameEn, nameVi: row.courseNameVi }, locale)}</UiText>
                </View>
                <StatusPill label={`${row.attendanceRate}%`} tone={rateTone(row.attendanceRate)} />
              </View>
              <ProgressBar value={row.attendanceRate} label={fillCopy(copy.presentOf, { present: row.present, total: row.total })} tone="success" />
            </Card>
          ))),
{ key: "static-1", render: () => <>{summary.length === 0 ? null : (<><View>
          <SectionHeading title={copy.recordsTitle} />
          {visibleRecords.length === 0 ? (
            <StatePanel kind="empty" title={copy.noRecords} />
          ) : null}</View></>)}</> },
...((summary.length === 0) ? [] : (visibleRecords.length === 0) ? [] : cardRows("section-2", visibleRecords, (item, index) => String(item.id ?? index), <>
              </>, (record, index) => (
                <View key={record.id} accessible accessibilityLabel={`${formatDate(record.date)}, ${copy.attendanceStatus[record.status] ?? record.status}`}>
                  {index > 0 ? <Divider /> : null}
                  <View style={academicStyles.row}>
                    <View style={academicStyles.rowCopy}>
                      <UiText variant="bodyMedium">{formatDate(record.date)}</UiText>
                      {record.section?.course?.code ? <UiText variant="bodySmall" tone="muted">{record.section.course.code}</UiText> : null}
                      {record.notes ? <UiText variant="meta" tone="muted">{record.notes}</UiText> : null}
                    </View>
                    <StatusPill label={copy.attendanceStatus[record.status] ?? record.status} tone={tone(record.status)} />
                  </View>
                </View>
              ), {}))], keyExtractor: (row) => row.key, renderItem: renderVirtualRow, footer: <>
    </> }}
    >
      <CheckinEntryCard navigation={navigation} />
      {options.length > 0 ? <TermField options={options} value={term} onChange={(value) => { setTerm(value); setSectionId(''); }} /> : null}
      {summary.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptyAttendance} />
      ) : (<><View>
          <ChoiceField
            label={copy.courseFilter}
            value={sectionId}
            onChange={setSectionId}
            display="sheet"
            options={[{ value: '', label: copy.allCourses }, ...summary.map((row) => ({ value: row.sectionId, label: `${row.courseCode} · ${localizedName({ name: row.courseName, nameEn: row.courseNameEn, nameVi: row.courseNameVi }, locale)}` }))]}
          />
          <Card tone="primary">
            <View style={styles.summaryHeader}>
              <IconChip icon="chart-donut" />
              <View style={styles.summaryCopy}>
                <UiText variant="label" tone="muted">{copy.overall}</UiText>
                <UiText variant="display" tone="primary">{overallRate(rows)}%</UiText>
              </View>
            </View>
            <ProgressBar label={copy.overall} value={overallRate(rows)} tone={overallRate(rows) >= 80 ? 'success' : 'warning'} />
          </Card>
          <ScreenSpacer />
          <View style={academicStyles.metrics}>
            <MetricCard icon="check-circle-outline" label={copy.present} value={formatNumber(sum('present'))} style={academicStyles.metric} />
            <MetricCard icon="close-circle-outline" label={copy.absent} value={formatNumber(sum('absent'))} style={academicStyles.metric} />
            <MetricCard icon="clock-outline" label={copy.late} value={formatNumber(sum('late'))} style={academicStyles.metric} />
            <MetricCard icon="email-check-outline" label={copy.excused} value={formatNumber(sum('excused'))} style={academicStyles.metric} />
          </View>
          <SectionHeading title={copy.byCourse} />
          </View></>)}</AcademicShell>
  );
}

const styles = {
  summaryHeader: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 12 },
  summaryCopy: { flex: 1, minWidth: 0 },
  courseHeader: { alignItems: 'flex-start' as const, flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
};
