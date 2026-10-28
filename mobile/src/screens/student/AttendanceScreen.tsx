import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Badge, Card, Divider, MetricCard, ProgressBar, ScreenSpacer, SectionHeading, StatePanel, UiText } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/choice-field';
import { useLocale } from '../../i18n/locale-provider';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi, type AttendanceSummaryRow } from '../academic/academic-api';
import { localizedName, termOptions } from '../academic/academic-model';
import { previewAttendance } from '../academic/academic-preview';
import { AcademicShell, TermField, academicStyles, isPreviewMode, useAcademicCopy, useAcademicQuery } from '../academic/academic-ui';

/** Attendance rate weighted by sessions, from the server per-course rates. */
export function overallRate(rows: readonly AttendanceSummaryRow[]): number {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  if (total === 0) return 0;
  return Math.round(rows.reduce((sum, row) => sum + row.attendanceRate * row.total, 0) / total);
}

const tone = (status: string) => (status === 'PRESENT' ? 'success' : status === 'ABSENT' ? 'error' : 'warning');

export function AttendanceScreen(_props: MobileScreenProps) {
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
    >
      {options.length > 0 ? <TermField options={options} value={term} onChange={(value) => { setTerm(value); setSectionId(''); }} /> : null}
      {summary.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptyAttendance} />
      ) : (
        <View>
          <ChoiceField
            label={copy.courseFilter}
            value={sectionId}
            onChange={setSectionId}
            display="sheet"
            options={[{ value: '', label: copy.allCourses }, ...summary.map((row) => ({ value: row.sectionId, label: `${row.courseCode} · ${localizedName({ name: row.courseName, nameEn: row.courseNameEn, nameVi: row.courseNameVi }, locale)}` }))]}
          />
          <Card tone="primary">
            <UiText variant="bodySmall" tone="muted">{copy.overall}</UiText>
            <UiText variant="display" tone="primary">{overallRate(rows)}%</UiText>
            <ProgressBar label={copy.overall} value={overallRate(rows)} tone="success" />
          </Card>
          <ScreenSpacer />
          <View style={academicStyles.metrics}>
            <MetricCard label={copy.present} value={formatNumber(sum('present'))} style={academicStyles.metric} />
            <MetricCard label={copy.absent} value={formatNumber(sum('absent'))} style={academicStyles.metric} />
            <MetricCard label={copy.late} value={formatNumber(sum('late'))} style={academicStyles.metric} />
            <MetricCard label={copy.excused} value={formatNumber(sum('excused'))} style={academicStyles.metric} />
          </View>
          <SectionHeading title={copy.byCourse} />
          {rows.map((row) => (
            <Card key={row.sectionId} style={academicStyles.card}>
              <View style={academicStyles.row}>
                <View style={academicStyles.rowCopy}>
                  <UiText variant="label">{row.courseCode}</UiText>
                  <UiText variant="bodySmall" tone="muted">{localizedName({ name: row.courseName, nameEn: row.courseNameEn, nameVi: row.courseNameVi }, locale)}</UiText>
                </View>
                <UiText variant="headlineSmall" tone="success">{row.attendanceRate}%</UiText>
              </View>
              <ProgressBar value={row.attendanceRate} label={fillCopy(copy.presentOf, { present: row.present, total: row.total })} tone="success" />
            </Card>
          ))}
          <SectionHeading title={copy.recordsTitle} />
          {visibleRecords.length === 0 ? (
            <StatePanel kind="empty" title={copy.noRecords} />
          ) : (
            <Card>
              {visibleRecords.map((record, index) => (
                <View key={record.id} accessible accessibilityLabel={`${formatDate(record.date)}, ${copy.attendanceStatus[record.status] ?? record.status}`}>
                  {index > 0 ? <Divider /> : null}
                  <View style={academicStyles.row}>
                    <View style={academicStyles.rowCopy}>
                      <UiText variant="bodyMedium">{formatDate(record.date)}</UiText>
                      {record.section?.course?.code ? <UiText variant="bodySmall" tone="muted">{record.section.course.code}</UiText> : null}
                      {record.notes ? <UiText variant="meta" tone="muted">{record.notes}</UiText> : null}
                    </View>
                    <Badge label={copy.attendanceStatus[record.status] ?? record.status} tone={tone(record.status)} />
                  </View>
                </View>
              ))}
            </Card>
          )}
        </View>
      )}
    </AcademicShell>
  );
}
