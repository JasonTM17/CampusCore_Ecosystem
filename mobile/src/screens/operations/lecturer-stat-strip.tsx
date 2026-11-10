import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { IconChip, UiText } from '../../components/Ui';
import type { UiIconName } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';

export interface LecturerStatItem {
  label: string;
  value: string;
  icon?: UiIconName;
  detail?: string;
}

const MIN_TILE_WIDTH = tokens.layout.touchTarget * 2 + tokens.spacing.md;

/**
 * The shared stat strip leaves its count unbounded, so a grouped total can
 * break between digits, and it gives the detail copy no room to keep a word
 * together inside a narrow card. This local strip keeps the shared surfaces
 * but pins the count to one line, lets the description wrap by words, and
 * trims the horizontal inset so the longest word stays whole at compact widths.
 */
export function LecturerStatStrip({ items, style }: { items: readonly LecturerStatItem[]; style?: StyleProp<ViewStyle> }) {
  const { colors, window } = useTheme();
  const availableWidth = window.width - tokens.layout.mobileGutter * 2;
  const perItemWidth = items.length > 0 ? availableWidth / items.length : availableWidth;
  const stacked = window.fontScale >= 1.3 || window.width < 360 || perItemWidth < MIN_TILE_WIDTH;
  return (
    <View style={[styles.strip, { backgroundColor: colors.card, borderColor: colors.outlineVariant, flexDirection: stacked ? 'column' : 'row' }, style]}>
      {items.map((item, index) => (
        <View key={item.label} accessible accessibilityLabel={`${item.label}: ${item.value}${item.detail ? `, ${item.detail}` : ''}`} style={[styles.card,
          index > 0 ? { borderColor: colors.outlineVariant, borderLeftWidth: stacked ? 0 : 1, borderTopWidth: stacked ? 1 : 0 } : undefined]}>
          <View style={styles.cardTop}>
            <UiText variant="headlineLarge" tone="primary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.value}>{item.value}</UiText>
            {item.icon ? <IconChip icon={item.icon} size={32} /> : null}
          </View>
          <UiText variant="label" tone="muted" style={styles.copy}>{item.label}</UiText>
          {item.detail ? <UiText variant="meta" tone="muted" style={styles.copy}>{item.detail}</UiText> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { borderWidth: 1, borderRadius: tokens.radii.card, overflow: 'hidden' },
  card: { flex: 1, minWidth: 0, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.sm + tokens.spacing.xs, gap: tokens.spacing.xs },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing.sm },
  value: { flexShrink: 1, fontVariant: ['tabular-nums'], minWidth: 0 },
  copy: { flexShrink: 1, minWidth: 0 },
});
