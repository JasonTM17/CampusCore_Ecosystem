import { useState } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { apiClient } from '../api/client';
import { chromeFor } from '../design/chrome';
import { tokens } from '../design/tokens';
import { useTheme } from '../design/theme';
import { useShellCopy } from '../i18n/use-shell-copy';
import { Sheet } from './ui/primitives';
import { UiText } from './ui/UiText';

export interface PreviewPillProps {
  style?: StyleProp<ViewStyle>;
}

/** Compact mode disclosure shared by the app bar and the sign-in preview entry. */
export function PreviewPill({ style }: PreviewPillProps) {
  const [open, setOpen] = useState(false);
  const { scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const { copy } = useShellCopy();
  const preview = apiClient.mode === 'preview';

  if (!preview) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.dashboard.previewData}
        hitSlop={4}
        onPress={() => setOpen(true)}
        testID="preview-pill"
        style={({ pressed }) => [styles.pill, { backgroundColor: pressed ? chrome.surfaceStrong : chrome.overlay }, style]}
      >
        <MaterialCommunityIcons accessible={false} importantForAccessibility="no" color={chrome.gold} name="information-outline" size={15} />
        <UiText variant="meta" numberOfLines={1} style={{ color: chrome.onSurface }}>{copy.previewLabel}</UiText>
      </Pressable>
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={copy.previewLabel}
        accessibilityLabel={copy.dashboard.previewData}
        closeLabel={copy.close}
        closeAccessibilityLabel={copy.close}
      >
        <UiText variant="bodySmall" tone="muted" style={styles.explanation}>{copy.dashboard.previewData}</UiText>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  pill: { alignItems: 'center', borderRadius: tokens.radii.pill, flexDirection: 'row', gap: tokens.spacing.xs, justifyContent: 'center', minHeight: tokens.layout.touchTarget, paddingHorizontal: tokens.spacing.sm },
  explanation: { paddingBottom: tokens.spacing.sm },
});
