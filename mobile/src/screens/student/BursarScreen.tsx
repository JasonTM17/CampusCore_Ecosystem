import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, DataNotice, StatePanel, UiText } from '../../components/Ui';
import { Button, StatusPill } from '../../components/ui/index';
import { apiClient } from '../../api/client';
import { tokens } from '../../design/tokens';
import { bursarMessages } from '../../i18n/bursar-messages';
import type { StatusTone } from '../../components/ui/institutional';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import type { MobileScreenProps } from '../../navigation/types';
import { errorCode } from '../content/content-errors';
import { ContentIconChip, ListFrame, useConfirm, useContentCopy, useFlash } from '../content/content-ui';
import { useListQuery } from '../content/use-list-query';
import {
  bursarApi,
  type BursarAccount,
  type BursarInvoice,
} from './bursar-api';
import { previewBursarAccount, previewBursarInvoices } from './bursar-preview';

function invoiceTone(status: string): StatusTone {
  switch (status) {
    case 'PAID': return 'success';
    case 'PARTIAL': return 'info';
    case 'CANCELLED': return 'neutral';
    default: return 'warning';
  }
}

/** Student tuition: balance + holds, invoices per term, demo payment (idempotent). Mirrors /hoc-phi on the portal. */
export function BursarScreen(_props: MobileScreenProps) {
  const { locale, formatDateTime, copy: common } = useContentCopy();
  const copy = bursarMessages[locale];
  const live = apiClient.mode === 'live';
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyInvoice, setBusyInvoice] = useState<string | null>(null);
  const busyRef = useRef(false);
  const { flash, success, fail, clear } = useFlash();
  const { ask, dialog } = useConfirm();

  const money = useCallback((amount: number, currency = 'VND') =>
    new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount),
  [locale]);

  const account = useScreenQuery<BursarAccount>('bursar.account', () => bursarApi.account(), { enabled: live });
  const accountData = live ? account.data : previewBursarAccount;
  const invoices = useListQuery<BursarInvoice>({
    key: 'bursar.invoices',
    fetchAll: () => bursarApi.invoices(),
    preview: previewBursarInvoices,
  });

  const pay = useCallback((invoice: BursarInvoice) => ask({
    title: copy.payTitle,
    description: `${copy.term} ${invoice.term} — ${money(invoice.remaining, accountData?.currency)}`,
    confirmLabel: copy.payDemo,
    cancelLabel: copy.cancel,
    onConfirm: () => {
      if (busyRef.current || !live) return;
      busyRef.current = true;
      setBusyInvoice(invoice.id);
      clear();
      // One key per confirmation: a client-side retry of this call replays the
      // same payment instead of posting a second one.
      const key = bursarApi.newPaymentKey();
      void bursarApi.pay(invoice.id, invoice.remaining, key)
        .then(async () => {
          success(copy.paidFlash);
          await Promise.all([invoices.reload(), account.reload()]);
        })
        .catch((error) => {
          void errorCode(error);
          fail(copy.failed);
        })
        .finally(() => {
          busyRef.current = false;
          setBusyInvoice(null);
        });
    },
  }), [account.reload, accountData?.currency, ask, clear, copy, fail, invoices, live, money, success]);

  const accountCard = (
    <Card>
      <View style={styles.rowMain}>
        <ContentIconChip icon="cash-multiple" />
        <View style={styles.rowCopy}>
          <UiText variant="label">{copy.balance}</UiText>
          {account.error && live ? (
            <StatePanel kind="error" title={copy.errorTitle} description={account.error} actionLabel={copy.retry} onAction={() => void account.reload()} />
          ) : (
            <>
              <UiText accessibilityLiveRegion="polite" variant="headlineSmall">
                {accountData ? money(accountData.balance, accountData.currency) : '—'}
              </UiText>
              <UiText variant="bodySmall" tone="muted">{copy.balanceHint}</UiText>
            </>
          )}
        </View>
      </View>
    </Card>
  );

  const holds = accountData?.holds ?? [];
  const holdsSection = (
    <View style={styles.section}>
      <UiText accessibilityRole="header" variant="headlineSmall">{copy.holds}</UiText>
      {holds.length === 0 ? (
        <UiText variant="bodySmall" tone="muted">{copy.emptyHolds}</UiText>
      ) : holds.map((hold) => (
        <Card key={hold.id}>
          <View style={styles.rowMain}>
            <ContentIconChip icon="lock-outline" />
            <View style={styles.rowCopy}>
              <UiText variant="label">{hold.reason}</UiText>
              <UiText variant="bodySmall" tone="muted">{formatDateTime(hold.createdAt)}</UiText>
              <View style={styles.chips}>
                <StatusPill label={copy.holdActive} tone="error" />
              </View>
            </View>
          </View>
        </Card>
      ))}
    </View>
  );

  return (
    <>
      <ListFrame
        title={copy.title}
        eyebrow={copy.eyebrow}
        description={copy.description}
        icon="cash-multiple"
        list={invoices}
        keyOf={(item) => item.id}
        emptyTitle={copy.emptyInvoices}
        flash={flash}
        header={(
          <View style={styles.header}>
            <DataNotice message={copy.demoBanner} />
            {accountCard}
            {holdsSection}
            <UiText accessibilityRole="header" variant="headlineSmall">{copy.invoices}</UiText>
          </View>
        )}
        renderItem={(item) => {
          const expanded = expandedId === item.id;
          const payable = live && item.remaining > 0 && item.status !== 'CANCELLED';
          return (
            <Card>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${copy.term} ${item.term} — ${copy.statusLabels[item.status as keyof typeof copy.statusLabels] ?? item.status} — ${money(item.remaining, accountData?.currency)}`}
                onPress={() => setExpandedId(expanded ? null : item.id)}
                style={styles.rowMain}
              >
                <ContentIconChip icon="receipt-text-outline" />
                <View style={styles.rowCopy}>
                  <UiText variant="label">{copy.term} {item.term}</UiText>
                  <UiText variant="bodySmall" tone="muted">
                    {`${copy.total}: ${money(item.total, accountData?.currency)} · ${copy.remaining}: ${money(item.remaining, accountData?.currency)}`}
                  </UiText>
                  <View style={styles.chips}>
                    <StatusPill label={copy.statusLabels[item.status as keyof typeof copy.statusLabels] ?? item.status} tone={invoiceTone(item.status)} />
                  </View>
                </View>
              </Pressable>
              {expanded ? (
                <View style={styles.detail}>
                  {item.dueAt ? <UiText variant="bodySmall" tone="muted">{copy.dueAt}: {formatDateTime(item.dueAt)}</UiText> : null}
                  {item.paidAt ? <UiText variant="bodySmall" tone="muted">{copy.paidAt}: {formatDateTime(item.paidAt)}</UiText> : null}
                  <UiText variant="label">{copy.items}</UiText>
                  {item.items.map((line) => (
                    <View key={line.id} style={styles.lineItem}>
                      <UiText variant="bodySmall" style={styles.lineLabel}>
                        {line.courseCode ? `${line.courseCode} — ` : ''}{line.label}
                      </UiText>
                      <UiText variant="bodySmall" tone="muted">
                        {line.credits} {copy.credits} · {money(line.amount, accountData?.currency)}
                      </UiText>
                    </View>
                  ))}
                  {payable ? (
                    <Button
                      label={`${copy.payDemo} — ${money(item.remaining, accountData?.currency)}`}
                      variant="primary"
                      disabled={busyInvoice !== null}
                      onPress={() => pay(item)}
                    />
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        }}
      />
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.spacing.md },
  section: { gap: tokens.spacing.sm },
  rowMain: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  chips: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  detail: { borderTopColor: tokens.colors.outlineVariant, borderTopWidth: StyleSheet.hairlineWidth, gap: tokens.spacing.xs, paddingTop: tokens.spacing.sm },
  lineItem: { flexDirection: 'row', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  lineLabel: { flex: 1, minWidth: 0 },
});
