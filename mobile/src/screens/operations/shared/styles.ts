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
  stats: { marginTop: tokens.spacing.sm, marginBottom: tokens.spacing.md },
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
  scheduleCard: { marginBottom: tokens.spacing.sm, padding: tokens.spacing.md, gap: tokens.spacing.xs },
  scheduleHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', gap: tokens.spacing.sm },
  topicCopy: { flex: 1, paddingRight: tokens.spacing.sm, gap: tokens.spacing.xs },
  gradingHero: { padding: tokens.spacing.lg },
  courseHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  gradeRow: { marginBottom: tokens.spacing.sm, padding: tokens.spacing.md, gap: tokens.spacing.xs },
  scoreFields: { flexDirection: 'row', gap: tokens.spacing.sm, marginTop: tokens.spacing.sm },
  scoreField: { flex: 1 },
  secondaryButton: { marginTop: tokens.spacing.sm },
  topButton: { marginTop: tokens.spacing.sm },
  actionStatus: { backgroundColor: colors.successFixed, borderColor: colors.success, borderLeftColor: colors.success, borderLeftWidth: 3, borderRadius: tokens.radii.control, borderWidth: 1, marginBottom: tokens.spacing.sm, padding: tokens.spacing.sm },
  actionStatusError: { backgroundColor: colors.errorFixed, borderColor: colors.error, borderLeftColor: colors.error, borderLeftWidth: 3, borderRadius: tokens.radii.control, borderWidth: 1, marginBottom: tokens.spacing.sm, padding: tokens.spacing.sm },
  saveBar: { marginTop: tokens.spacing.md, gap: tokens.spacing.sm, padding: tokens.spacing.md, backgroundColor: colors.card, borderRadius: tokens.radii.card, borderWidth: 1, borderColor: colors.outlineVariant },
  filterChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs, marginBottom: tokens.spacing.md },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, marginTop: tokens.spacing.xs },
  sheetBody: { paddingVertical: tokens.spacing.md, gap: tokens.spacing.md },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: tokens.spacing.sm },
  detailLabel: { flex: 1, color: colors.textMuted },
  detailValue: { flex: 2, textAlign: 'right' },
  directoryRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md },
  directoryCopy: { flex: 1, minWidth: 0, gap: tokens.spacing.xs },
  directoryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing.sm },
});

export function useOpsStyles() {
  return useThemedStyles(opsStyles);
}
