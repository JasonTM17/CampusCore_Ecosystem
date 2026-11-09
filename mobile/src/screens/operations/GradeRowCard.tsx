import { memo } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { Card, Field, StatusPill, UiText } from '../../components/Ui';
import { Avatar } from '../../components/ui/avatar';
import { chromeFontScaleCap } from '../../design/font-scale';
import { tokens } from '../../design/tokens';
import { useLocale } from '../../i18n/locale-provider';
import { fillCopy } from '../../i18n/academic-messages';
import type { OperationsCopy } from '../../i18n/operations-messages';
import { calculateGrade, calculateTotalScore } from './lecturer-csv';
import { isLockedGrade, parseScore, type GradeRowLike, type ScoreEdit, type ScoreProblem } from './lecturer-model';
import { useOpsStyles } from './shared/styles';

export interface GradeRowCardProps {
  row: GradeRowLike;
  edit: ScoreEdit | undefined;
  problems: Partial<Record<'processScore' | 'finalExamScore', ScoreProblem>> | undefined;
  /** The row moved on the server at the last explicit reload after a conflict. */
  changed?: boolean;
  copy: OperationsCopy;
  onEdit: (enrollmentId: string, field: 'processScore' | 'finalExamScore', text: string) => void;
  disabled?: boolean;
}

const problemText = (copy: OperationsCopy, problem: ScoreProblem | undefined) =>
  problem === 'invalid' ? copy.invalidScore : problem === 'needsProcess' ? copy.needsProcess : undefined;

/** One student's two scores. Published rows are read-only; a total shows once both scores parse. */
function Row({ row, edit, problems, changed = false, copy, onEdit, disabled = false }: GradeRowCardProps) {
  const styles = useOpsStyles();
  const { formatNumber } = useLocale();
  const { fontScale, width } = useWindowDimensions();
  const largeText = fontScale >= chromeFontScaleCap && width < tokens.windowClasses.compactMax;
  const name = row.studentName ?? row.studentCode ?? row.enrollmentId;
  const locked = isLockedGrade(row);
  const scoreDisplay = (value: number | null | undefined) => value == null ? '' : formatNumber(value, { maximumFractionDigits: 2 });
  const processText = edit?.processScore ?? scoreDisplay(row.processScore);
  const finalText = edit?.finalExamScore ?? scoreDisplay(row.finalExamScore);
  const process = parseScore(processText);
  const final = parseScore(finalText);
  const total = typeof process === 'number' && typeof final === 'number' ? calculateTotalScore(process, final) : null;
  const totalText = total === null ? '—' : formatNumber(total, { maximumFractionDigits: 1 });
  const letter = total === null ? '—' : calculateGrade(total);

  return (
    <Card style={styles.gradeRow}>
      <View style={styles.rowBetween}>
        <View style={styles.directoryRow}>
          <Avatar decorative name={name} size="sm" />
          <View style={styles.rowCopy}>
            <UiText variant="label">{name}</UiText>
            {row.studentCode ? <UiText variant="bodySmall" tone="muted">{row.studentCode}</UiText> : null}
            <UiText variant="bodySmall" tone="muted">{row.email ?? copy.unavailableEmail}</UiText>
            {row.gradeStatus === 'APPEALED' ? <StatusPill label={copy.appealed} tone="warning" /> : null}
            {changed ? <StatusPill label={copy.changedOnServer} tone="warning" /> : null}
          </View>
        </View>
        <View style={styles.gradeTotals}>
          <View style={styles.gradeTotalCell}>
            <UiText variant="meta" tone="muted">{copy.total}</UiText>
            <UiText variant="label">{totalText}</UiText>
          </View>
          <View style={styles.gradeTotalCell}>
            <UiText variant="meta" tone="muted">{copy.letter}</UiText>
            <UiText variant="label">{letter}</UiText>
          </View>
        </View>
      </View>
      {locked ? (
        <View style={{ marginTop: 8, gap: 4 }}>
          <StatusPill label={copy.lockedPublished} tone="neutral" icon="lock-outline" />
          <UiText variant="bodySmall" tone="muted">
            {`${copy.process} ${processText || '—'} · ${copy.finalExam} ${finalText || '—'}`}
          </UiText>
        </View>
      ) : (
        <View style={largeText ? [styles.scoreFields, { flexWrap: 'wrap' }] : styles.scoreFields}>
          <Field
            label={copy.process}
            accessibilityLabel={`${fillCopy(copy.gradeRowLabel, { name })}, ${copy.process}`}
            keyboardType="decimal-pad"
            onChangeText={(text) => onEdit(row.enrollmentId, 'processScore', text)}
            placeholder={copy.scorePlaceholder}
            style={largeText
              ? [styles.scoreField, { flexBasis: '100%', flexShrink: 1, minWidth: 0 }]
              : styles.scoreField}
            value={processText}
            editable={!disabled}
            error={problemText(copy, problems?.processScore)}
          />
          <Field
            label={copy.finalExam}
            accessibilityLabel={`${fillCopy(copy.gradeRowLabel, { name })}, ${copy.finalExam}`}
            keyboardType="decimal-pad"
            onChangeText={(text) => onEdit(row.enrollmentId, 'finalExamScore', text)}
            placeholder={copy.scorePlaceholder}
            style={largeText
              ? [styles.scoreField, { flexBasis: '100%', flexShrink: 1, minWidth: 0 }]
              : styles.scoreField}
            value={finalText}
            editable={!disabled}
            error={problemText(copy, problems?.finalExamScore)}
          />
        </View>
      )}
    </Card>
  );
}

export const GradeRowCard = memo(Row);
