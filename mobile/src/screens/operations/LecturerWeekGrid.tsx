import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import type { OperationsCopy } from '../../i18n/operations-messages';
import { teachingGrid, type MeetingSource } from './lecturer-model';

const fitLabel = { numberOfLines: 1 as const, adjustsFontSizeToFit: true, minimumFontScale: 0.75 };

export interface LecturerWeekGridProps {
  sections: readonly MeetingSource[];
  copy: OperationsCopy;
  todayNumber: number;
  onSelect: (sectionId: string) => void;
}

/** Horizontally scrolling day-by-start-time timetable built from the same meetings as the list. */
export function LecturerWeekGrid({ sections, copy, todayNumber, onSelect }: LecturerWeekGridProps) {
  const grid = teachingGrid(sections, copy.roomPending);
  return (
    <View style={styles.block}>
      <UiText accessibilityRole="header" variant="headlineSmall">{copy.weeklyAgenda}</UiText>
      <UiText variant="bodySmall" tone="muted" style={styles.hint}>{copy.clickToViewDetails}</UiText>
      <ScrollView horizontal accessibilityLabel={copy.weeklyGridLabel} testID="lecturer-week-grid">
        <View style={styles.gridColumn}>
          <View style={styles.row}>
            <View style={styles.timeCell} />
            {grid.days.map((day) => (
              <View key={day} style={styles.dayCell}>
                <UiText variant="label" {...fitLabel}>{copy.dayLong[day] ?? ''}</UiText>
                {day === todayNumber ? <UiText variant="meta" tone="primary" {...fitLabel}>{copy.todayChip}</UiText> : null}
              </View>
            ))}
          </View>
          {grid.slots.map((slot) => (
            <View key={slot} style={styles.row}>
              <View style={styles.timeCell}>
                <UiText variant="meta" {...fitLabel}>{slot}</UiText>
              </View>
              {grid.days.map((day) => {
                const items = grid.cells[`${day}-${slot}`] ?? [];
                return (
                  <View key={day} style={styles.dayCell}>
                    {items.map((item) => (
                      <Pressable
                        key={item.key}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.courseCode}${item.sectionNumber ? `-${item.sectionNumber}` : ''}, ${copy.dayLong[item.dayOfWeek] ?? ''}, ${item.startTime}–${item.endTime}, ${item.room}`}
                        onPress={() => onSelect(item.sectionId)}
                        style={styles.meeting}
                      >
                        <UiText variant="label" {...fitLabel}>{item.courseCode}</UiText>
                        {item.sectionNumber ? <UiText variant="meta" {...fitLabel}>{item.sectionNumber}</UiText> : null}
                        <UiText variant="meta" tone="muted" {...fitLabel}>{item.room}</UiText>
                      </Pressable>
                    ))}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: tokens.spacing.sm, marginBottom: tokens.spacing.md, minWidth: 0 },
  hint: { minWidth: 0 },
  gridColumn: { gap: tokens.spacing.xs },
  row: { flexDirection: 'row', minWidth: 0 },
  timeCell: { justifyContent: 'center', minHeight: 48, minWidth: 0, width: 72 },
  dayCell: { minHeight: 48, minWidth: 0, padding: tokens.spacing.xs, width: 112 },
  meeting: { justifyContent: 'center', minHeight: 48, minWidth: 48 },
});
