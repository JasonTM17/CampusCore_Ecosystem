import { StyleSheet } from 'react-native';

import { tokens } from '../../../design/tokens';
import { useThemedStyles } from '../../../design/theme';
import type { ThemeColors } from '../../../design/theme';

const opsStyles = (colors: ThemeColors) => StyleSheet.create({
  webOnlyCard: { gap: tokens.spacing.sm, padding: tokens.spacing.lg },
  webOnlyCopy: { marginBottom: tokens.spacing.sm },
  submit: { marginTop: tokens.spacing.sm },
  hero: { padding: tokens.spacing.lg },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginBottom: tokens.spacing.md },
  metric: { flexBasis: 140, flexGrow: 1 },
  rowBetween: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  rowCopy: { flex: 1, minWidth: 160 },
  searchBar: { marginBottom: tokens.spacing.md },
  stack: { gap: tokens.spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs, marginTop: tokens.spacing.sm },
  chip: { alignItems: 'center', borderRadius: tokens.radii.control, borderWidth: 1, flexGrow: 1, justifyContent: 'center', minHeight: tokens.layout.touchTarget, minWidth: tokens.layout.touchTarget, paddingHorizontal: tokens.spacing.sm },
  rosterCard: { marginBottom: tokens.spacing.sm, padding: tokens.spacing.md },
  heroTitle: { marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.sm },
  metricGrid: { flexDirection: 'row' },
  metricLeft: { marginRight: tokens.spacing.sm },
  scheduleCard: { marginBottom: tokens.spacing.sm, padding: tokens.spacing.md },
  scheduleHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  topicCopy: { flex: 1, paddingRight: tokens.spacing.sm },
  gradingHero: { padding: tokens.spacing.lg },
  courseHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  gradeRow: { marginBottom: tokens.spacing.sm, padding: tokens.spacing.md },
  scoreFields: { flexDirection: 'row', gap: tokens.spacing.sm, marginTop: tokens.spacing.sm },
  scoreField: { flex: 1 },
  secondaryButton: { marginTop: tokens.spacing.sm },
  topButton: { marginTop: tokens.spacing.sm },
  actionStatus: { backgroundColor: colors.successFixed, borderColor: colors.success, borderLeftColor: colors.success, borderLeftWidth: 3, borderRadius: tokens.radii.control, borderWidth: 1, marginBottom: tokens.spacing.sm, padding: tokens.spacing.sm },
  actionStatusError: { backgroundColor: colors.errorFixed, borderColor: colors.error, borderLeftColor: colors.error, borderLeftWidth: 3, borderRadius: tokens.radii.control, borderWidth: 1, marginBottom: tokens.spacing.sm, padding: tokens.spacing.sm },
});


export function useOpsStyles() {
  return useThemedStyles(opsStyles);
}
