import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Field, StatusPill, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { fillCopy } from '../../i18n/academic-messages';
import { useLocale } from '../../i18n/locale-provider';
import { submitCreditLimitApplication, type CreditLimitApplication, type RegistrationEligibility } from './academic-api';
import { academicStyles, isPreviewMode, useAcademicCopy } from './academic-ui';

export interface CreditLimitCardProps {
  roundId: string | null;
  eligibility: RegistrationEligibility | null;
  application: CreditLimitApplication | null;
  onSubmitted: (application: CreditLimitApplication) => void;
}

/** The web credit-limit policy: the standard cap, an approved exception and the 30-credit request. */
export function CreditLimitCard({ roundId, eligibility, application, onSubmitted }: CreditLimitCardProps) {
  const { copy } = useAcademicCopy();
  const { colors } = useTheme();
  const { formatNumber } = useLocale();
  const preview = isPreviewMode();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const creditLimit = typeof eligibility?.creditLimit === 'number' && eligibility.creditLimit > 0 ? eligibility.creditLimit : null;
  const approvedLimit = application?.status === 'APPROVED' && typeof application.requestedLimit === 'number' ? application.requestedLimit : null;
  const canSubmit = !application || application.status === 'REJECTED';
  const status = application?.status === 'APPROVED'
    ? {
      label: fillCopy(copy.applicationStatusApproved, { count: formatNumber(approvedLimit ?? 0) }),
      description: fillCopy(copy.applicationApproved, { count: formatNumber(approvedLimit ?? 0) }),
      tone: 'success' as const,
    }
    : application?.status === 'REJECTED'
      ? { label: copy.applicationStatusRejected, description: copy.applicationRejected, tone: 'error' as const }
      : application
        ? { label: copy.applicationStatusPending, description: copy.applicationPending, tone: 'warning' as const }
        : null;

  const submit = async () => {
    const trimmed = reason.trim();
    if (!roundId || trimmed.length < 20) {
      setError(copy.applicationReasonInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const submitted = await submitCreditLimitApplication(roundId, trimmed);
      setReason('');
      setNotice(copy.applicationSubmitted);
      onSubmitted(submitted);
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code;
      setError(code === 'CREDIT_LIMIT_APPLICATION_EXISTS' ? copy.applicationAlreadyExists : copy.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={academicStyles.card}>
      <UiText accessibilityRole="header" variant="headlineSmall">{copy.limitPolicyTitle}</UiText>
      <UiText variant="bodySmall" tone="muted" style={styles.description}>{copy.limitPolicyDescription}</UiText>
      <View style={styles.tiles}>
        <View style={[styles.tile, { borderColor: colors.outlineVariant }]}>
          <UiText variant="meta" tone="muted">{copy.termCreditLimitLabel}</UiText>
          <UiText variant="headlineSmall" style={styles.value}>
            {creditLimit === null ? copy.creditLimitUnavailable : `${formatNumber(creditLimit)} ${copy.creditsUnit}`}
          </UiText>
        </View>
        <View style={[styles.tile, { borderColor: colors.primary }]}>
          <UiText variant="meta" tone="primary">{copy.approvedLimitLabel}</UiText>
          <UiText variant="headlineSmall" style={styles.value}>
            {approvedLimit !== null
              ? `${formatNumber(approvedLimit)} ${copy.creditsUnit}`
              : application?.status === 'PENDING' ? copy.approvedLimitPendingValue : copy.approvedLimitNone}
          </UiText>
          <UiText variant="meta" tone="muted">
            {approvedLimit !== null ? copy.approvedLimitAppliedHint : application?.status === 'PENDING' ? copy.approvedLimitPendingHint : copy.approvedLimitHint}
          </UiText>
        </View>
      </View>

      {status ? (
        <View style={styles.status}>
          <StatusPill label={status.label} tone={status.tone} />
          <UiText variant="bodySmall" tone="muted">{status.description}</UiText>
          {application?.reviewerNote ? (
            <UiText variant="bodySmall" tone="muted">{copy.applicationReviewNote}: {application.reviewerNote}</UiText>
          ) : null}
        </View>
      ) : null}

      {canSubmit ? (
        <View style={styles.form}>
          <UiText variant="label">{copy.applicationTitle}</UiText>
          <UiText variant="bodySmall" tone="muted">{copy.applicationDescription}</UiText>
          <Field
            label={copy.applicationReasonLabel}
            value={reason}
            onChangeText={setReason}
            placeholder={copy.applicationReasonPlaceholder}
            hint={`${copy.applicationReasonHint} ${reason.length}/1000`}
            maxLength={1000}
            editable={!busy && !preview}
          />
          <UiText variant="meta" tone="muted">{copy.applicationOfficeOnly}</UiText>
          {error ? <UiText accessibilityRole="alert" variant="bodySmall" tone="error">{error}</UiText> : null}
          <Button label={busy ? copy.applicationSubmitting : copy.applicationSubmit} onPress={() => void submit()} loading={busy} disabled={busy || preview} />
        </View>
      ) : null}
      {notice ? <UiText accessibilityLiveRegion="polite" variant="bodySmall" tone="success" style={styles.notice}>{notice}</UiText> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  description: { marginTop: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  tile: { borderRadius: tokens.radii.control, borderWidth: 1, flexBasis: 140, flexGrow: 1, gap: 4, padding: 12 },
  value: { fontVariant: ['tabular-nums'] },
  status: { gap: 6, marginTop: 12 },
  form: { gap: 8, marginTop: 12 },
  notice: { marginTop: 8 },
});
