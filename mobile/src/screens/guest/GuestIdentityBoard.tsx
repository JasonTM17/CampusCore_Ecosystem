import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { useLocale } from '../../i18n/locale-provider';
import { shellMessages } from '../../i18n/shell-messages';

type IdentityRole = keyof (typeof shellMessages)['vi']['guestHome']['identityBoard']['rows'];

const IDENTITY_ROLES: readonly IdentityRole[] = ['student', 'lecturer', 'admin'];

export function GuestIdentityBoard({ onOpenPortal }: { onOpenPortal: () => void }) {
  const { colors, window } = useTheme();
  const { locale } = useLocale();
  const copy = shellMessages[locale].guestHome.identityBoard;
  const [activeRole, setActiveRole] = useState<IdentityRole>('student');

  return (
    <Card style={[styles.board, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
      <UiText variant="meta" style={[styles.eyebrow, { color: colors.onPrimary }]}>{copy.eyebrow}</UiText>
      <View
        accessibilityLabel={copy.eyebrow}
        accessibilityRole="tablist"
        testID="guest-identity-tabs"
        style={[
          styles.tabs,
          { borderBottomColor: colors.onPrimary },
          window.fontScale >= 1.3 ? styles.stackedTabs : undefined,
        ]}
      >
        {IDENTITY_ROLES.map((role) => {
          const selected = role === activeRole;
          return (
            <Pressable
              key={role}
              accessibilityLabel={copy.tabs[role]}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setActiveRole(role)}
              style={({ pressed }) => [
                styles.tab,
                { borderBottomColor: selected ? colors.onPrimary : 'transparent', opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <UiText variant="label" style={[{ color: colors.onPrimary }, selected ? styles.selectedTabLabel : undefined]}>{copy.tabs[role]}</UiText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.rows}>
        {copy.rows[activeRole].map((row) => (
          <View key={row.title} style={styles.row}>
            <MaterialCommunityIcons accessible={false} importantForAccessibility="no" color={colors.onPrimary} name="check-circle-outline" size={18} />
            <View style={styles.rowCopy}>
              <UiText variant="label" style={{ color: colors.onPrimary }}>{row.title}</UiText>
              <UiText variant="bodySmall" style={{ color: colors.onPrimary }}>{row.description}</UiText>
            </View>
          </View>
        ))}
      </View>
      <Button
        icon="arrow-right"
        label={copy.portalActions[activeRole]}
        onPress={onOpenPortal}
        style={styles.portalButton}
        variant="secondary"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  board: { gap: tokens.spacing.md },
  eyebrow: { letterSpacing: 0.6, textTransform: 'uppercase' },
  tabs: { borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  stackedTabs: { flexDirection: 'column' },
  tab: { alignItems: 'center', borderBottomWidth: 2, flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: tokens.spacing.xs },
  selectedTabLabel: { fontWeight: '700' },
  rows: { gap: tokens.spacing.md },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  portalButton: { alignSelf: 'stretch' },
});
