import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { Card, StatusPill, UiText } from '../../components/Ui';
import { Avatar } from '../../components/ui/avatar';
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

const statusToneMap: Record<MarkStatus, 'success' | 'error' | 'warning' | 'primary'> = {
  PRESENT: 'success',
  ABSENT: 'error',
  LATE: 'warning',
  EXCUSED: 'primary',
};

export interface AttendanceRosterRowProps {
  row: RosterRow;
  copy: OperationsCopy;
  /** Tapping the chosen status again clears the mark. */
  onChange: (studentId: string, status: MarkStatus | null) => void;
  disabled?: boolean;
}

/** One student: avatar initials, name, code and four status choices with >=44dp targets that wrap cleanly. */
function Row({ row, copy, onChange, disabled = false }: AttendanceRosterRowProps) {
  const styles = useOpsStyles();
  const { colors } = useTheme();
  const current = row.status ? statusLabel(copy, row.status) : copy.unmarked;

  return (
    <Card style={styles.rosterCard}>
      <View
        accessible
        accessibilityLabel={fillCopy(copy.statusOf, { name: row.name, status: current })}
        style={styles.directoryRow}
      >
        <Avatar decorative name={row.name} size="sm" />
        <View style={styles.directoryCopy}>
          <UiText variant="label">{row.name}</UiText>
          {row.studentCode ? (
            <UiText variant="bodySmall" tone="muted">{row.studentCode}</UiText>
          ) : null}
        </View>
        {row.status ? (
          <StatusPill
            label={statusLabel(copy, row.status)}
            tone={statusToneMap[row.status]}
          />
        ) : null}
      </View>
      <View style={styles.chips}>
        {MARK_STATUSES.map((status) => {
          const selected = row.status === status;
          const label = statusLabel(copy, status);
          const tone = statusToneMap[status];
          const activeBg = colors[`${tone}Fixed` as keyof typeof colors] ?? colors.primaryFixed;
          const activeInk = colors[tone as keyof typeof colors] ?? colors.primary;

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
                {
                  borderColor: selected ? activeInk : colors.outlineVariant,
                  backgroundColor: selected ? activeBg : colors.card,
                },
              ]}
            >
              <UiText variant="label" style={{ color: selected ? activeInk : colors.textMuted }}>
                {label}
              </UiText>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

export const AttendanceRosterRow = memo(Row);
