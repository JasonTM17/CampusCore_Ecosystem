import { StyleSheet } from 'react-native';

import { tokens } from '../../../design/tokens';
import { useThemedStyles } from '../../../design/theme';
import type { ThemeColors } from '../../../design/theme';

export const studentStyles = (colors: ThemeColors) => StyleSheet.create({
  heroCard: { marginBottom: tokens.spacing.md },
  heroCopy: { marginBottom: tokens.spacing.md },
  heroTitle: { marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.sm },
  metricGrid: { flexDirection: 'row' },
  metricLeft: { marginRight: tokens.spacing.sm },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  actionButton: { marginBottom: tokens.spacing.sm, width: '48%' },
  weekCard: { padding: tokens.spacing.sm },
  weekHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  weekTitle: { alignItems: 'center' },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: tokens.spacing.sm },
  dayCell: { alignItems: 'center', borderRadius: tokens.radii.control, justifyContent: 'center', minHeight: 48, width: 35 },
  dayCellActive: { backgroundColor: colors.primary },
  scheduleCard: { alignItems: 'center', flexDirection: 'row', marginBottom: tokens.spacing.sm, padding: tokens.spacing.sm },
  scheduleTime: { alignItems: 'center', borderRightColor: colors.outlineVariant, borderRightWidth: 1, marginRight: tokens.spacing.sm, paddingRight: tokens.spacing.sm },
  scheduleInfo: { flex: 1, paddingRight: tokens.spacing.xs },
  noteCard: { marginTop: tokens.spacing.sm },
  summaryCard: { padding: tokens.spacing.lg },
  courseCard: { marginBottom: tokens.spacing.sm },
  courseHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  courseCopy: { flex: 1, paddingRight: tokens.spacing.sm },
  cardCopy: { marginBottom: tokens.spacing.md, marginTop: tokens.spacing.xs },
  attendanceHero: { padding: tokens.spacing.lg },
  attendanceCard: { marginBottom: tokens.spacing.sm },
  registrationHero: { padding: tokens.spacing.lg },
  registrationHeroHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, marginBottom: tokens.spacing.md, marginTop: tokens.spacing.xs },
  registrationHeroCopy: { flex: 1, gap: tokens.spacing.xs },
  registrationCard: { marginBottom: tokens.spacing.sm },
  registrationCourseTitle: { marginTop: tokens.spacing.xs },
  registrationMeta: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, marginBottom: tokens.spacing.md, marginTop: tokens.spacing.sm },
  registrationSlot: { flex: 1 },
  notificationSummary: { padding: tokens.spacing.md },
  profileHero: { padding: tokens.spacing.lg },
  profileHeader: { alignItems: 'center', flexDirection: 'row' },
  profileCopy: { flex: 1, marginLeft: tokens.spacing.md },
  signOut: { marginTop: tokens.spacing.md },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cardGridItem: { width: '48%' },
});

export function useStudentStyles() {
  return useThemedStyles(studentStyles);
}
