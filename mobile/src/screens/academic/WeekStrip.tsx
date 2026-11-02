import { Pressable, StyleSheet, View } from 'react-native';

import { UiText } from '../../components/ui/UiText';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { civilDayOf, civilKey } from './academic-model';

export interface WeekStripProps {
  days: Date[];
  selectedIndex: number;
  todayKey: string;
  labels: readonly string[];
  onSelect(index: number): void;
}

export function WeekStrip({ days, selectedIndex, todayKey, labels, onSelect }: WeekStripProps) {
  const { colors } = useTheme();
  return (
    <View testID="week-strip" style={styles.dayStrip}>
      {days.map((date, index) => {
        const selected = index === selectedIndex;
        const isToday = civilKey(date) === todayKey;
        return (
          <Pressable
            key={civilKey(date)}
            testID={`day-${civilKey(date)}`}
            accessibilityRole="button"
            accessibilityLabel={`${labels[index]} ${civilDayOf(date)}`}
            accessibilityState={{ selected }}
            onPress={() => onSelect(index)}
            style={[styles.dayCell, { backgroundColor: selected ? colors.primaryFixed : 'transparent' }]}
          >
            <UiText variant="meta" tone="muted">{labels[index]}</UiText>
            <UiText variant="label" tone={selected || isToday ? 'primary' : 'default'} style={styles.dayDate}>
              {civilDayOf(date)}
            </UiText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dayStrip: { flexDirection: 'row', flexWrap: 'wrap', marginTop: tokens.spacing.sm },
  dayCell: {
    alignItems: 'center',
    borderRadius: tokens.radii.control,
    flexBasis: tokens.layout.touchTarget,
    flexGrow: 1,
    flexShrink: 1,
    justifyContent: 'center',
    minHeight: tokens.layout.touchTarget,
    paddingVertical: tokens.spacing.xs,
  },
  dayDate: { fontVariant: ['tabular-nums'] },
});
