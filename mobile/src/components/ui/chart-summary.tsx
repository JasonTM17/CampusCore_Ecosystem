import { StyleSheet, View } from 'react-native';

import { useTheme } from '../../design/theme';
import { useLocale } from '../../i18n/locale-provider';
import { UiText } from './UiText';

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartSummaryProps {
  title: string;
  series: readonly ChartPoint[];
  /** `bars` lists labelled horizontal bars; `sparkline` draws compact columns. */
  kind?: 'bars' | 'sparkline';
  /** Appended to values in the text, for example `%` or `điểm`. */
  unit?: string;
}

/** Share of the largest value (0 to 1) per point; negatives and non-finite values count as 0. */
export function barRatios(values: readonly number[]): number[] {
  const safe = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const max = Math.max(0, ...safe);
  return safe.map((v) => (max === 0 ? 0 : v / max));
}

export function ChartSummary({ title, series, kind = 'bars', unit }: ChartSummaryProps) {
  const { colors, spacing, radii } = useTheme();
  const { t, formatNumber } = useLocale();
  const fmt = (value: number) => `${formatNumber(value)}${unit ? ` ${unit}` : ''}`;
  const validSeries = series.filter((point) => Number.isFinite(point.value));
  const ratios = barRatios(validSeries.map((point) => point.value));

  let alternative = `${title}: ${t('chartNoData')}`;
  if (validSeries.length > 0) {
    const values = validSeries.map((point) => point.value);
    const detail = kind === 'bars'
      ? validSeries.map((point) => `${point.label} ${fmt(point.value)}`).join(', ')
      : `${validSeries[0].label} - ${validSeries[validSeries.length - 1].label}; ${t('chartRange', {
          min: fmt(Math.min(...values)),
          max: fmt(Math.max(...values)),
          last: fmt(validSeries[validSeries.length - 1].value),
        })}`;
    alternative = `${title}: ${detail}`;
  }

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={alternative}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.outlineVariant, borderRadius: radii.card, padding: spacing.md }]}
    >
      <UiText variant="headlineSmall">{title}</UiText>
      {validSeries.length === 0 ? (
        <UiText variant="bodySmall" tone="muted" style={{ marginTop: spacing.xs }}>{t('chartNoData')}</UiText>
      ) : kind === 'bars' ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {validSeries.map((point, i) => (
            <View key={`${point.label}-${i}`}>
              <View style={styles.barHead}>
                <UiText variant="bodySmall" style={styles.grow}>{point.label}</UiText>
                <UiText variant="label" tone="muted">{fmt(point.value)}</UiText>
              </View>
              <View style={[styles.track, { backgroundColor: colors.surfaceHigh }]}>
                <View style={{ backgroundColor: colors.primary, borderRadius: 4, height: 8, width: `${Math.round(ratios[i] * 100)}%` }} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={[styles.spark, { gap: spacing.xs, marginTop: spacing.sm }]}>
          {validSeries.map((point, i) => (
            <View
              key={`${point.label}-${i}`}
              style={{ backgroundColor: i === validSeries.length - 1 ? colors.primary : colors.primaryContainer, borderRadius: 2, flex: 1, height: Math.max(2, Math.round(ratios[i] * 48)) }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  grow: { flex: 1 },
  track: { borderRadius: 4, height: 8, overflow: 'hidden' },
  spark: { alignItems: 'flex-end', flexDirection: 'row', height: 48 },
});
