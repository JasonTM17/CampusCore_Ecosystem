import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useTheme } from '../../design/theme';
import { useLocale } from '../../i18n/locale-provider';
import { Button } from './Button';
import { UiText } from './UiText';
import type { TextTone } from './UiText';

export type FileRowStatus = 'ready' | 'busy' | 'failed' | 'unavailable';

export interface FileRowAction {
  key: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

export interface FileRowProps {
  name: string;
  sizeBytes?: number | null;
  status?: FileRowStatus;
  /** Replaces the default status text, for example a failure reason. */
  statusLabel?: string;
  /** 0 to 1 while a transfer is running. */
  progress?: number;
  actions?: readonly FileRowAction[];
}

const statusTone: Record<FileRowStatus, TextTone> = { ready: 'muted', busy: 'primary', failed: 'error', unavailable: 'warning' };

export function FileRow({ name, sizeBytes, status = 'ready', statusLabel, progress, actions = [] }: FileRowProps) {
  const { colors, spacing, radii, layout } = useTheme();
  const { t, formatBytes } = useLocale();
  const defaults: Record<FileRowStatus, string> = {
    ready: t('fileReady'),
    busy: t('fileBusy'),
    failed: t('fileFailed'),
    unavailable: t('fileUnavailable'),
  };
  const statusText = statusLabel ?? defaults[status];
  const size = sizeBytes === null || sizeBytes === undefined ? null : formatBytes(sizeBytes);
  const ratio = typeof progress === 'number' ? Math.min(1, Math.max(0, progress)) : null;
  const disableActions = status === 'busy';

  return (
    <View
      style={[styles.row, { backgroundColor: colors.card, borderColor: colors.outlineVariant, borderRadius: radii.card, minHeight: layout.touchTarget, padding: spacing.md }]}
    >
      <View style={styles.info}>
        <UiText variant="bodyMedium">{name}</UiText>
        <View style={[styles.meta, { gap: spacing.sm }]}>
          {size ? <UiText variant="meta" tone="muted">{size}</UiText> : null}
          <View accessibilityLiveRegion={status === 'failed' ? 'assertive' : 'polite'} style={styles.meta}>
            {status === 'busy' ? <ActivityIndicator color={colors.primary} size="small" /> : null}
            <UiText variant="meta" tone={statusTone[status]}>{statusText}</UiText>
          </View>
        </View>
        {ratio !== null ? (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={name}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
            style={[styles.track, { backgroundColor: colors.surfaceHigh, marginTop: spacing.xs }]}
          >
            <View style={{ backgroundColor: colors.primary, borderRadius: 2, height: 4, width: `${Math.round(ratio * 100)}%` }} />
          </View>
        ) : null}
      </View>
      {actions.length > 0 ? (
        <View style={[styles.actions, { gap: spacing.xs }]}>
          {actions.map((action) => (
            <Button
              key={action.key}
              label={action.label}
              accessibilityLabel={`${action.label}: ${name}`}
              onPress={action.onPress}
              disabled={action.disabled || disableActions}
              variant="text"
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  info: { flex: 1, minWidth: 160 },
  meta: { alignItems: 'center', flexDirection: 'row' },
  track: { borderRadius: 2, height: 4, overflow: 'hidden' },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
});
