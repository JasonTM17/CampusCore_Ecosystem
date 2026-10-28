import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { Card, UiText } from '../../components/Ui';
import { useTheme } from '../../design/theme';
import { fillCopy } from '../../i18n/academic-messages';
import type { OperationsCopy } from '../../i18n/operations-messages';
import { MARK_STATUSES, type MarkStatus, type RosterRow } from './lecturer-model';
import { useOpsStyles } from './shared/styles';

export const statusLabel = (copy: OperationsCopy, status: MarkStatus): string => ({
  PRESENT: copy.statusPresent,
  ABSENT: copy.statusAbsent,
  LATE: copy.statusLate,
  EXCUSED: copy.statusExcused,
})[status];

export interface AttendanceRosterRowProps {
  row: RosterRow;
  copy: OperationsCopy;
  /** Tapping the chosen status again clears the mark. */
  onChange: (studentId: string, status: MarkStatus | null) => void;
  disabled?: boolean;
}

/** One student: name, code and four status choices with 44dp targets that wrap at large font sizes. */
function Row({ row, copy, onChange, disabled = false }: AttendanceRosterRowProps) {
  const styles = useOpsStyles();
  const { colors } = useTheme();
  const current = row.status ? statusLabel(copy, row.status) : copy.unmarked;
  return (
    <Card style={styles.rosterCard}>
      <View accessible accessibilityLabel={fillCopy(copy.statusOf, { name: row.name, status: current })}>
        <UiText variant="label">{row.name}</UiText>
        <UiText variant="bodySmall" tone="muted">{row.studentCode}</UiText>
      </View>
      <View style={styles.chips}>
        {MARK_STATUSES.map((status) => {
          const selected = row.status === status;
          const label = statusLabel(copy, status);
          return (
            <Pressable
              key={status}
              accessibilityRole="radio"
              accessibilityLabel={fillCopy(copy.markStatusFor, { name: row.name, status: label })}
              accessibilityState={{ checked: selected, selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(row.studentId, selected ? null : status)}
              style={[
                styles.chip,
                { borderColor: selected ? colors.primary : colors.outlineVariant, backgroundColor: selected ? colors.primaryFixed : colors.card },
              ]}
            >
              <UiText variant="label" tone={selected ? 'primary' : 'muted'}>{label}</UiText>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

export const AttendanceRosterRow = memo(Row);
