import { memo } from 'react';
import { View } from 'react-native';

import { Card, Field, UiText } from '../../components/Ui';
import { useLocale } from '../../i18n/locale-provider';
import { fillCopy } from '../../i18n/academic-messages';
import type { OperationsCopy } from '../../i18n/operations-messages';
import { calculateGrade, calculateTotalScore } from './lecturer-csv';
import { isLockedGrade, parseScore, scoreText, type GradeRowLike, type ScoreEdit, type ScoreProblem } from './lecturer-model';
import { useOpsStyles } from './shared/styles';

export interface GradeRowCardProps {
  row: GradeRowLike;
  edit: ScoreEdit | undefined;
  problems: Partial<Record<'processScore' | 'finalExamScore', ScoreProblem>> | undefined;
  copy: OperationsCopy;
  onEdit: (enrollmentId: string, field: 'processScore' | 'finalExamScore', text: string) => void;
  disabled?: boolean;
}

const problemText = (copy: OperationsCopy, problem: ScoreProblem | undefined) =>
  problem === 'invalid' ? copy.invalidScore : problem === 'needsProcess' ? copy.needsProcess : undefined;

/** One student's two scores. Published rows are read-only; a total shows once both scores parse. */
function Row({ row, edit, problems, copy, onEdit, disabled = false }: GradeRowCardProps) {
  const styles = useOpsStyles();
  const { formatNumber } = useLocale();
  const name = row.studentName ?? row.studentCode ?? row.enrollmentId;
  const locked = isLockedGrade(row);
  const processText = edit?.processScore ?? scoreText(row.processScore);
  const finalText = edit?.finalExamScore ?? scoreText(row.finalExamScore);
  const process = parseScore(processText);
  const final = parseScore(finalText);
  const total = typeof process === 'number' && typeof final === 'number' ? calculateTotalScore(process, final) : null;
  const totalLabel = total === null
    ? copy.noGradeYet
    : `${formatNumber(total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ${calculateGrade(total)}`;

  return (
    <Card style={styles.gradeRow}>
      <View style={styles.rowBetween}>
        <View style={styles.rowCopy}>
          <UiText variant="label">{name}</UiText>
          {row.studentCode ? <UiText variant="bodySmall" tone="muted">{row.studentCode}</UiText> : null}
        </View>
        <UiText variant="bodyMedium" tone="primary" accessibilityLabel={`${copy.total}: ${totalLabel}`}>{totalLabel}</UiText>
      </View>
      {locked ? (
        <UiText variant="bodySmall" tone="muted">
          {`${copy.process} ${processText || '—'} · ${copy.finalExam} ${finalText || '—'} · ${copy.lockedPublished}`}
        </UiText>
      ) : (
        <View style={styles.scoreFields}>
          <Field
            label={copy.process}
            accessibilityLabel={`${fillCopy(copy.gradeRowLabel, { name })}, ${copy.process}`}
            keyboardType="decimal-pad"
            onChangeText={(text) => onEdit(row.enrollmentId, 'processScore', text)}
            placeholder={copy.scorePlaceholder}
            style={styles.scoreField}
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
            style={styles.scoreField}
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
