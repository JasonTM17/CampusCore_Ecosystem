import { StyleSheet, View } from 'react-native';

import { Button, StatusPill, UiText } from '../../components/Ui';
import { Sheet } from '../../components/ui/primitives';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { recordsMessages } from '../../i18n/records-messages';
import { conductStatusKey, type ConductActivity } from './records-model';
import { useContentCopy } from './content-ui';

export interface ConductActivityDetailSheetProps {
  activity: ConductActivity | null;
  termStatus: string | null;
  studentCode: string | null;
  fullName: string | null;
  certificateError: boolean;
  onClose: () => void;
  onOpenCertificate: (url: string) => void;
}

function validCertificateUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Web conduct activity metadata modal — preview panel with certificate action. */
export function ConductActivityDetailSheet({
  activity,
  termStatus,
  studentCode,
  fullName,
  certificateError,
  onClose,
  onOpenCertificate,
}: ConductActivityDetailSheetProps) {
  const { locale, formatDate, formatNumber } = useContentCopy();
  const { colors } = useTheme();
  const copy = recordsMessages[locale];
  const sheet = copy.conductActivitySheet;
  const approved = conductStatusKey(termStatus) === 'APPROVED';
  const statusLabel = approved ? copy.conductApprovedBadge : copy.conductStatuses[conductStatusKey(termStatus)];
  const recordBadge = approved ? sheet.recordBadge : statusLabel;
  const dateLabel = activity?.activityDate ? formatDate(activity.activityDate) : '—';
  const certificateUrl = validCertificateUrl(activity?.certificateUrl);

  if (!activity) return null;

  return (
    <Sheet
      visible
      scroll
      onClose={onClose}
      title={sheet.previewTitle}
      closeLabel={sheet.close}
      closeAccessibilityLabel={sheet.close}
      accessibilityLabel={sheet.previewTitle}
    >
      <View style={[styles.body, { borderColor: colors.outlineVariant }]}>
        <View style={styles.institutionBlock}>
          <UiText variant="meta" tone="muted" style={styles.institution}>
            {sheet.institution}
          </UiText>
          <UiText variant="label" tone="primary">
            {sheet.office}
          </UiText>
          <UiText accessibilityRole="header" variant="headlineSmall" style={styles.recordTitle}>
            {sheet.certificateTitle}
          </UiText>
          <UiText variant="meta" tone="muted">{sheet.certificateSubtitle}</UiText>
        </View>

        <View style={[styles.statusRow, approved ? styles.statusApproved : styles.statusNeutral, { borderColor: colors.outlineVariant, backgroundColor: approved ? colors.successFixed : colors.surfaceLow }]}>
          <StatusPill label={recordBadge} tone={approved ? 'success' : 'neutral'} />
        </View>

        <View style={[styles.studentRow, { backgroundColor: colors.surfaceLow, borderColor: colors.outlineVariant }]}>
          <View style={styles.studentCell}>
            <UiText variant="meta" tone="muted">{sheet.confirmedStudent}</UiText>
            <UiText variant="bodyMedium">{fullName?.trim() ? fullName : '—'}</UiText>
          </View>
          <View style={styles.studentCell}>
            <UiText variant="meta" tone="muted">{sheet.studentId}</UiText>
            <UiText variant="bodyMedium">{studentCode?.trim() ? studentCode : '—'}</UiText>
          </View>
        </View>

        <View style={[styles.activityCard, { borderColor: colors.outlineVariant }]}>
          <UiText variant="meta" tone="muted">{sheet.activityLabel}</UiText>
          <UiText variant="bodyMedium" tone="primary">{activity.title}</UiText>
          <View style={styles.metaGrid}>
            <View style={styles.metaItem}>
              <UiText variant="meta" tone="muted">{sheet.fieldLabel}</UiText>
              <UiText variant="bodySmall">{activity.category ?? '—'}</UiText>
            </View>
            <View style={styles.metaItem}>
              <UiText variant="meta" tone="muted">{sheet.recordedDate}</UiText>
              <UiText variant="bodySmall">{dateLabel}</UiText>
            </View>
          </View>
          <UiText variant="meta" tone="muted">{sheet.organizerLabel}</UiText>
          <UiText variant="bodySmall">{activity.organizer ?? '—'}</UiText>
          <View style={styles.bonusRow}>
            <UiText variant="meta" tone="muted">{sheet.bonusConductPoints}</UiText>
            <UiText variant="headlineSmall" tone="primary">
              {activity.points != null
                ? `+${formatNumber(activity.points)} ${copy.conductScoreUnit}`
                : '—'}
            </UiText>
          </View>
        </View>

        <UiText variant="bodySmall" tone="muted" style={[styles.previewNote, { borderColor: colors.outlineVariant }]}>
          {sheet.previewNote}
        </UiText>

        {certificateUrl ? (
          <Button
            label={copy.conductCertificate}
            accessibilityLabel={`${copy.conductCertificate}: ${activity.title}`}
            variant="secondary"
            onPress={() => onOpenCertificate(certificateUrl)}
          />
        ) : null}
        {certificateError ? (
          <UiText accessibilityRole="alert" variant="bodySmall" tone="error">
            {copy.conductCertificateOpenFailed}
          </UiText>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: tokens.spacing.md },
  institutionBlock: { alignItems: 'center', gap: tokens.spacing.xs },
  institution: { letterSpacing: 0.8, textAlign: 'center', textTransform: 'uppercase' },
  recordTitle: { textAlign: 'center' },
  statusRow: { borderRadius: tokens.radii.control, borderWidth: 1, padding: tokens.spacing.sm },
  statusApproved: {},
  statusNeutral: {},
  studentRow: { borderRadius: tokens.radii.control, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, padding: tokens.spacing.sm },
  studentCell: { flex: 1, gap: 2, minWidth: 120 },
  activityCard: { borderRadius: tokens.radii.card, borderWidth: 1, gap: tokens.spacing.xs, padding: tokens.spacing.md },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.md },
  metaItem: { flex: 1, gap: 2, minWidth: 120 },
  bonusRow: { alignItems: 'flex-end', gap: 2, marginTop: tokens.spacing.xs },
  previewNote: { borderStyle: 'dashed', borderWidth: 1, padding: tokens.spacing.sm },
});
