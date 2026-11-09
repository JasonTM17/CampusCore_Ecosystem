import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { UiText } from '../Ui';
import { StatusPill } from '../ui/index';
import type { UiIconName } from '../ui/index';
import { minTapTarget, tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { webUrlFor } from './rich-content';

export interface RichAttachment {
  name: string;
  url: string;
  type: 'pdf' | 'docx' | 'xlsx' | 'zip' | 'other';
}

export interface RichAttachmentsProps {
  attachments: readonly RichAttachment[];
  heading: string;
  countLabel: string;
  documentLabel: string;
}

const ICONS: Record<RichAttachment['type'], UiIconName> = {
  pdf: 'file-pdf-box',
  docx: 'file-word-box',
  xlsx: 'file-excel-box',
  zip: 'zip-box',
  other: 'paperclip',
};

/** The attachment panel the web reader shows under a notice body. */
export function RichAttachments({ attachments, heading, countLabel, documentLabel }: RichAttachmentsProps) {
  const { colors } = useTheme();
  if (attachments.length === 0) return null;
  return (
    <View style={styles.attachments}>
      <View style={styles.head}>
        <UiText variant="label">{heading}</UiText>
        <StatusPill label={countLabel} tone="primary" />
      </View>
      {attachments.map((file) => {
        const ink = file.type === 'pdf' ? colors.error
          : file.type === 'docx' ? colors.primary
            : file.type === 'xlsx' ? colors.success
              : file.type === 'zip' ? colors.warning
                : colors.textMuted;
        return (
          <Pressable
            key={`${file.url}:${file.name}`}
            accessibilityLabel={file.name}
            accessibilityRole="link"
            onPress={() => { void Linking.openURL(webUrlFor(file.url)).catch(() => undefined); }}
            style={({ pressed }) => [styles.row, {
              backgroundColor: pressed ? colors.surfaceLow : colors.surface,
              borderColor: colors.outlineVariant,
            }]}
          >
            <MaterialCommunityIcons accessible={false} color={ink} importantForAccessibility="no" name={ICONS[file.type]} size={20} />
            <View style={styles.copy}>
              <UiText variant="bodySmall">{file.name}</UiText>
              <UiText variant="meta" tone="muted">{`${file.type.toUpperCase()} · ${documentLabel}`}</UiText>
            </View>
            <MaterialCommunityIcons accessible={false} color={colors.textMuted} importantForAccessibility="no" name="download" size={20} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  attachments: { gap: tokens.spacing.sm, marginTop: tokens.spacing.md },
  head: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  row: {
    alignItems: 'center',
    borderRadius: tokens.radii.control,
    borderWidth: 1,
    flexDirection: 'row',
    gap: tokens.spacing.sm,
    minHeight: minTapTarget,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
  },
  copy: { flex: 1, minWidth: 0 },
});
