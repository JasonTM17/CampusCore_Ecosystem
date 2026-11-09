import { Pressable, StyleSheet, View } from 'react-native';

import { UiText } from '../../components/ui/UiText';
import { minTapTarget, tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { civilDayOf, civilKey } from './academic-model';
import { useLocale } from '../../i18n/locale-provider';
import { academicMessages } from '../../i18n/academic-messages';

export interface WeekStripProps {
  days: Date[];
  selectedIndex: number;
  todayKey: string;
  labels: readonly string[];
  todayLabel?: string;
  onSelect(index: number): void;
}

export function WeekStrip({ days, selectedIndex, todayKey, labels, todayLabel, onSelect }: WeekStripProps) {
  const { colors } = useTheme();
  const { locale } = useLocale();
  const copy = academicMessages[locale];
  const resolvedToday = todayLabel ?? copy.today;
  return (
    <View testID="week-strip" style={styles.dayStrip}>
      {days.map((date, index) => {
        const selected = index === selectedIndex;
        const isToday = civilKey(date) === todayKey;
        const baseLabel = `${labels[index]} ${civilDayOf(date)}`;
        return (
          <Pressable
            key={civilKey(date)}
            testID={`day-${civilKey(date)}`}
            accessibilityRole="button"
            accessibilityLabel={isToday ? `${baseLabel}, ${resolvedToday}` : baseLabel}
            accessibilityState={{ selected }}
            onPress={() => onSelect(index)}
            style={[styles.dayCell, { backgroundColor: selected ? colors.primaryFixed : 'transparent' }]}
          >
            <UiText variant="meta" tone="muted">{labels[index]}</UiText>
            <UiText variant="label" tone={selected || isToday ? 'primary' : 'default'} style={styles.dayDate}>
              {civilDayOf(date)}
            </UiText>
            {isToday ? <UiText variant="meta" tone="primary" style={styles.todayBadge}>{resolvedToday}</UiText> : null}
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
    flexBasis: minTapTarget,
    flexGrow: 1,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: minTapTarget,
    minWidth: minTapTarget,
    paddingVertical: tokens.spacing.xs,
  },
  dayDate: { fontVariant: ['tabular-nums'] },
  todayBadge: { fontSize: 9, textAlign: 'center' },
});
