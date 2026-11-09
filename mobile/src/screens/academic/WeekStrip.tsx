import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { UiText } from '../../components/ui/UiText';
import { minTapTarget, tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { civilDayOf, civilKey } from './academic-model';
import { useLocale } from '../../i18n/locale-provider';
import { academicMessages } from '../../i18n/academic-messages';

const weekStripFontScaleCap = 1.2;
const shrinkLabel = { numberOfLines: 1 as const, adjustsFontSizeToFit: true, maxFontSizeMultiplier: weekStripFontScaleCap };

export interface WeekStripProps {
  days: Date[];
  selectedIndex: number;
  todayKey: string;
  labels: readonly string[];
  todayLabel?: string;
  onSelect(index: number): void;
  style?: StyleProp<ViewStyle>;
}

export function WeekStrip({ days, selectedIndex, todayKey, labels, todayLabel, onSelect, style }: WeekStripProps) {
  const { colors } = useTheme();
  const { locale } = useLocale();
  const copy = academicMessages[locale];
  const resolvedToday = todayLabel ?? copy.today;
  return (
    <View testID="week-strip" style={[styles.dayStrip, style]}>
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
            <UiText variant="meta" tone="muted" {...shrinkLabel}>{labels[index]}</UiText>
            <UiText variant="label" tone={selected || isToday ? 'primary' : 'default'} style={styles.dayDate} {...shrinkLabel}>
              {civilDayOf(date)}
            </UiText>
            {isToday ? (
              <UiText variant="meta" tone="primary" style={styles.todayBadge} {...shrinkLabel}>
                {resolvedToday}
              </UiText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dayStrip: { flexDirection: 'row', flexWrap: 'nowrap', flex: 1, minWidth: 0 },
  dayCell: {
    alignItems: 'center',
    borderRadius: tokens.radii.control,
    flex: 1,
    flexShrink: 1,
    justifyContent: 'center',
    minHeight: minTapTarget,
    minWidth: 0,
    paddingHorizontal: tokens.spacing.xs / 2,
    paddingVertical: tokens.spacing.xs,
  },
  dayDate: { fontVariant: ['tabular-nums'] },
  todayBadge: { fontSize: 9, textAlign: 'center' },
});
