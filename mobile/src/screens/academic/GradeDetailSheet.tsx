import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Divider, Sheet, StatusPill, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { useLocale } from '../../i18n/locale-provider';
import { academicApi, type GradeBreakdownLine } from './academic-api';
import { localizedName } from './academic-model';
import { isPreviewMode, useAcademicCopy } from './academic-ui';
import { resolveGradePoint } from './gpa';

export interface GradeDetailRecord {
  id: string;
  courseCode: string;
  courseName: string;
  courseNameEn?: string | null;
  courseNameVi?: string | null;
  credits?: number | null;
  sectionCode?: string | null;
  lecturerName?: string | null;
  semester?: string | null;
  semesterNameEn?: string | null;
  semesterNameVi?: string | null;
  processScore?: number | null;
  finalExamScore?: number | null;
  finalGrade?: number | null;
  letterGrade?: string | null;
  gradePoint?: number | null;
}

export interface GradeDetailSheetProps {
  record: GradeDetailRecord | null;
  semesterLabel?: string;
  onClose: () => void;
}

const isFiniteScore = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function itemLabel(
  item: GradeBreakdownLine,
  copy: ReturnType<typeof useAcademicCopy>['copy']['gradeDetail'],
): string {
  const known = (item.gradeItemType ?? '').toUpperCase();
  if (known === 'PROCESS') return copy.processItem;
  if (known === 'FINAL') return copy.finalItem;
  return item.gradeItemName ?? '';
}

function weightLabel(weight: number | undefined, emptyValue: string): string {
  if (!isFiniteScore(weight)) return emptyValue;
  return weight <= 1 ? `${Math.round(weight * 100)}%` : `${weight}%`;
}

/** The web "Course Grade Breakdown" dialog: same fields, labels and order. */
export function GradeDetailSheet({ record, semesterLabel, onClose }: GradeDetailSheetProps) {
  const { copy, locale } = useAcademicCopy();
  const detail = copy.gradeDetail;
  const { formatNumber } = useLocale();
  const { colors } = useTheme();
  const [lines, setLines] = useState<GradeBreakdownLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!record?.id) {
      setLines([]);
      setFailed(false);
      setLoading(false);
      return;
    }
    if (isPreviewMode()) {
      setLines([]);
      setFailed(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    academicApi
      .gradeBreakdown(record.id)
      .then((data) => {
        if (!cancelled) setLines(Array.isArray(data?.grades) ? data.grades : []);
      })
      .catch(() => {
        if (!cancelled) {
          setLines([]);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [record?.id]);

  if (!record) return null;

  const scoreText = (value: number | null | undefined) =>
    isFiniteScore(value)
      ? formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : detail.emptyValue;
  const items: GradeBreakdownLine[] = lines.length > 0
    ? lines
    : isFiniteScore(record.processScore) && isFiniteScore(record.finalExamScore)
      ? [
          { id: 'process-grade', gradeItemId: 'process', gradeItemName: detail.processItem, gradeItemType: 'PROCESS', score: record.processScore, maxScore: 10, weight: 50 },
          { id: 'final-exam-grade', gradeItemId: 'final_exam', gradeItemName: detail.finalItem, gradeItemType: 'FINAL', score: record.finalExamScore, maxScore: 10, weight: 50 },
        ]
      : [];
  const semester = (locale === 'vi' ? record.semesterNameVi ?? record.semesterNameEn : record.semesterNameEn ?? record.semesterNameVi)
    ?? record.semester
    ?? semesterLabel
    ?? '';
  const point = resolveGradePoint(record);

  return (
    <Sheet scroll visible onClose={onClose} title={detail.title}>
      <View style={styles.body}>
        <View style={[styles.courseCard, { backgroundColor: colors.surfaceLow, borderColor: colors.outlineVariant }]}>
          <View style={styles.courseMeta}>
            <StatusPill label={record.courseCode} tone="primary" />
            {record.sectionCode ? <StatusPill label={record.sectionCode} tone="neutral" /> : null}
            {isFiniteScore(record.credits) ? (
              <UiText variant="meta" tone="muted">{`${formatNumber(record.credits)} ${detail.credits}`}</UiText>
            ) : null}
          </View>
          <UiText variant="bodyMedium" style={styles.courseName}>
            {localizedName({ name: record.courseName, nameEn: record.courseNameEn, nameVi: record.courseNameVi }, locale) || record.courseCode}
          </UiText>
          {[record.lecturerName, semester].filter(Boolean).length > 0 ? (
            <UiText variant="meta" tone="muted">
              {[record.lecturerName, semester].filter(Boolean).join(' · ')}
            </UiText>
          ) : null}
        </View>

        <View style={styles.componentsHead}>
          <UiText variant="label" style={styles.grow}>{detail.componentsTitle}</UiText>
          <UiText variant="meta" tone="muted">{detail.formula}</UiText>
        </View>

        {failed ? (
          <UiText variant="bodySmall" tone="warning">{detail.detailFailed}</UiText>
        ) : null}

        {loading ? (
          <UiText variant="meta" tone="muted">{detail.loading}</UiText>
        ) : items.length === 0 ? (
          <UiText variant="bodySmall" tone="muted">{detail.empty}</UiText>
        ) : (
          <View style={[styles.table, { borderColor: colors.outlineVariant }]}>
            <View style={[styles.tableHead, { backgroundColor: colors.surfaceLow }]}>
              <UiText variant="meta" tone="muted" style={styles.componentCell}>{detail.component}</UiText>
              <UiText variant="meta" tone="muted" style={styles.weightCell}>{detail.weight}</UiText>
              <UiText variant="meta" tone="muted" style={styles.scoreCell}>{detail.score}</UiText>
            </View>
            {items.map((item, index) => (
              <View key={item.id ?? item.gradeItemId ?? index}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.componentRow}>
                  <UiText variant="bodySmall" style={styles.componentCell}>{itemLabel(item, detail)}</UiText>
                  <UiText variant="meta" tone="muted" style={styles.weightCell}>{weightLabel(item.weight, detail.emptyValue)}</UiText>
                  <UiText variant="label" style={styles.scoreCell}>
                    {`${scoreText(item.score)} / ${item.maxScore ?? 10}`}
                  </UiText>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={[styles.summary, { backgroundColor: colors.surfaceLow, borderColor: colors.outlineVariant }]}>
          <View style={styles.summaryCell}>
            <UiText variant="meta" tone="muted">{detail.finalScore}</UiText>
            <UiText variant="headlineSmall">{scoreText(record.finalGrade)}</UiText>
          </View>
          <View style={styles.summaryCell}>
            <UiText variant="meta" tone="muted">{detail.letterGrade}</UiText>
            <UiText variant="headlineSmall" tone="primary">{record.letterGrade || detail.emptyValue}</UiText>
          </View>
          <View style={styles.summaryCell}>
            <UiText variant="meta" tone="muted">{detail.gradePoint}</UiText>
            <UiText variant="headlineSmall">{point === null ? detail.emptyValue : formatNumber(point, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</UiText>
          </View>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: tokens.spacing.md },
  courseCard: { borderWidth: 1, borderRadius: tokens.radii.card, gap: tokens.spacing.xs, padding: tokens.spacing.md },
  courseMeta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  courseName: { flexShrink: 1 },
  componentsHead: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  grow: { flex: 1, minWidth: 0 },
  table: { borderRadius: tokens.radii.control, borderWidth: 1, overflow: 'hidden' },
  tableHead: { flexDirection: 'row', gap: tokens.spacing.sm, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.xs },
  componentRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.sm },
  componentCell: { flex: 2, minWidth: 100 },
  weightCell: { flex: 1, minWidth: 48, textAlign: 'center' },
  scoreCell: { flex: 1, minWidth: 72, textAlign: 'right' },
  summary: { borderRadius: tokens.radii.card, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, padding: tokens.spacing.md },
  summaryCell: { flex: 1, gap: tokens.spacing.xs, minWidth: 88 },
});
