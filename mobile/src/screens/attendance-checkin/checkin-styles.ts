import { StyleSheet } from 'react-native';

import { tokens } from '../../design/tokens';
import { useThemedStyles, type ThemeColors } from '../../design/theme';

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  sessionCard: { gap: tokens.spacing.xs },
  sessionRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.md, minHeight: tokens.layout.touchTarget, paddingVertical: tokens.spacing.xs },
  sessionCopy: { flex: 1, minWidth: 0 },
  entryRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.md },
  entryCopy: { flex: 1, minWidth: 160 },
  consentList: { gap: tokens.spacing.xs, paddingVertical: tokens.spacing.xs },
  consentRow: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm },
  actions: { gap: tokens.spacing.sm, paddingTop: tokens.spacing.sm },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  actionGrow: { flexGrow: 1, minWidth: 140 },
  resultWrap: { gap: tokens.spacing.sm },
  codeInput: {
    borderColor: colors.outlineVariant,
    borderRadius: tokens.radii.control,
    borderWidth: 1,
    color: colors.text,
    fontSize: 20,
    letterSpacing: 6,
    minHeight: tokens.layout.touchTarget,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    textAlign: 'center',
  },
  codeLabel: { paddingBottom: tokens.spacing.xs },
});

export function useCheckinStyles() {
  return useThemedStyles(makeStyles);
}
