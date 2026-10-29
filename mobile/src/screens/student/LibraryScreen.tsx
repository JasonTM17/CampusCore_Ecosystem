import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, DataNotice, UiText } from '../../components/Ui';
import { FilterChip, SearchBar, SegmentedControl, StatusPill } from '../../components/ui/index';
import { apiClient } from '../../api/client';
import type { MobileLibraryLoan, MobileLibraryTitle } from '../../api/client';
import { tokens } from '../../design/tokens';
import { fillCopy } from '../../i18n/academic-messages';
import { libraryMessages } from '../../i18n/library-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from '../content/content-api';
import { contentErrorMessage, errorCode } from '../content/content-errors';
import { filterLoans, firstAvailableCopy, isLoanCancellable, joinMeta, type LoanTab } from '../content/content-rules';
import { ContentIconChip, ListFrame, StatusChip, useConfirm, useContentCopy, useFlash } from '../content/content-ui';
import { LibraryTitleDetail } from '../content/LibraryTitleDetail';
import { previewLibraryLoans, previewLibraryTitles } from '../content/preview-data';
import { useListQuery } from '../content/use-list-query';
import { usePagedList } from '../content/use-paged-list';

type Tab = 'catalogue' | 'loans';

/** Patron library: catalogue search and holds, own loans with cancel. Availability is always read from the server. */
export function LibraryScreen(_props: MobileScreenProps) {
  const { locale, formatDate, copy: common, t } = useContentCopy();
  const copy = libraryMessages[locale];
  const [tab, setTab] = useState<Tab>('catalogue');
  const [loanTab, setLoanTab] = useState<LoanTab>('active');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [filter, setFilter] = useState<{ availability?: string[] }>({});
  const [busy, setBusy] = useState(false);
  const { flash, success, fail, clear } = useFlash();
  const { ask, dialog } = useConfirm();
  const availableOnly = (filter.availability ?? []).includes('available');
  const toggleAvailability = () => setFilter((current) => ({
    availability: (current.availability ?? []).includes('available') ? [] : ['available'],
  }));

  const previewTitles = useMemo(() => previewLibraryTitles(locale), [locale]);
  const previewLoans = useMemo(() => previewLibraryLoans(locale), [locale]);
  const catalogue = usePagedList<MobileLibraryTitle>({
    key: `content.library.catalogue.${search}`,
    fetchPage: (page, limit, signal) => contentApi.libraryCatalogue({ page, limit, signal, query: search || undefined }),
    keyOf: (item) => item.id,
    eager: availableOnly,
    preview: previewTitles,
  });
  const loans = useListQuery<MobileLibraryLoan>({
    key: 'content.library.loans',
    fetchAll: () => contentApi.libraryLoans(),
    preview: previewLoans,
  });

  const run = useCallback(async (action: () => Promise<unknown>, ok: string) => {
    if (busy || apiClient.mode !== 'live') return;
    setBusy(true);
    clear();
    try {
      await action();
      success(ok);
      setReloadToken((value) => value + 1);
      void catalogue.reload();
      void loans.reload();
    } catch (error) {
      fail(errorCode(error) === 'NO_COPY' ? copy.noCopiesAvailable : contentErrorMessage(common, error, copy.failed));
    } finally {
      setBusy(false);
    }
  }, [busy, catalogue, clear, common, copy.failed, copy.noCopiesAvailable, fail, loans, success]);

  const hold = (title: MobileLibraryTitle) => ask({
    title: copy.holdTitle,
    description: title.title,
    confirmLabel: copy.hold,
    cancelLabel: t('cancel'),
    onConfirm: () => void run(async () => {
      // The detail read carries the copies; availability can change between list and hold.
      const detail = await contentApi.libraryTitle(title.id);
      const target = firstAvailableCopy(detail.copies);
      if (!target) throw Object.assign(new Error('no copy'), { code: 'NO_COPY' });
      await contentApi.libraryRequest(target.id);
    }, copy.held),
  });

  const cancelLoan = (loan: MobileLibraryLoan) => ask({
    title: copy.cancelTitle,
    description: loan.title ?? loan.barcode ?? undefined,
    confirmLabel: copy.cancel,
    cancelLabel: copy.keep,
    destructive: true,
    onConfirm: () => void run(() => contentApi.libraryCancel(loan.id, loan.version), copy.cancelled),
  });

  if (selected) {
    return (
      <>
        <LibraryTitleDetail
          titleId={selected}
          busy={busy}
          flash={flash}
          reloadToken={reloadToken}
          onBack={() => { setSelected(null); clear(); }}
          onHold={hold}
        />
        {dialog}
      </>
    );
  }

  const tabs = (
    <SegmentedControl
      accessibilityLabel={copy.title}
      value={tab}
      onChange={(value) => setTab(value as Tab)}
      options={[{ value: 'catalogue', label: copy.catalogue }, { value: 'loans', label: copy.myLoans }]}
    />
  );
  const banner = <DataNotice message={copy.simulatedBanner} />;
  const rows = availableOnly ? catalogue.items.filter((item) => item.availableCopies > 0) : catalogue.items;

  return (
    <>
      {tab === 'catalogue' ? (
        <ListFrame
          title={copy.title}
          icon="bookshelf"
          list={catalogue}
          items={rows}
          filtered={availableOnly || search.length > 0}
          keyOf={(item) => item.id}
          emptyTitle={copy.emptyCatalogue}
          flash={flash}
          header={(
            <View style={styles.header}>
              {banner}
              {tabs}
              <SearchBar
                value={input}
                onChangeText={setInput}
                onClear={() => { setInput(''); setSearch(''); }}
                placeholder={copy.searchPlaceholder}
                accessibilityLabel={copy.search}
                returnKeyType="search"
                onSubmitEditing={() => setSearch(input.trim())}
              />
              <View style={styles.filterRow}>
                <FilterChip label={copy.availableOnly} selected={availableOnly} onPress={toggleAvailability} />
              </View>
            </View>
          )}
          renderItem={(item) => (
            <Card>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={joinMeta([item.title, item.author, fillCopy(copy.copiesAvailable, { available: item.availableCopies, total: item.totalCopies })])}
                onPress={() => setSelected(item.id)}
                style={styles.rowMain}
              >
                <ContentIconChip icon="book-open-page-variant-outline" />
                <View style={styles.rowCopy}>
                  <UiText variant="label">{item.title}</UiText>
                  <UiText variant="bodySmall" tone="muted">{joinMeta([item.author, item.category])}</UiText>
                  <View style={styles.chips}>
                    <StatusPill
                      label={item.availableCopies > 0
                        ? fillCopy(copy.copiesAvailable, { available: item.availableCopies, total: item.totalCopies })
                        : copy.noCopiesAvailable}
                      tone={item.availableCopies > 0 ? 'success' : 'warning'}
                    />
                  </View>
                </View>
              </Pressable>
            </Card>
          )}
        />
      ) : (
        <ListFrame
          title={copy.title}
          icon="book-check-outline"
          list={loans}
          items={filterLoans(loans.items, loanTab)}
          filtered
          keyOf={(item) => item.id}
          emptyTitle={loanTab === 'active' ? copy.emptyLoans : copy.emptyHistory}
          flash={flash}
          header={(
            <View style={styles.header}>
              {banner}
              {tabs}
              <SegmentedControl
                accessibilityLabel={copy.myLoans}
                value={loanTab}
                onChange={(value) => setLoanTab(value as LoanTab)}
                options={[{ value: 'active', label: copy.loansActive }, { value: 'history', label: copy.loansHistory }]}
              />
            </View>
          )}
          renderItem={(loan) => (
            <Card>
              <View accessible accessibilityLabel={joinMeta([loan.title ?? loan.barcode, copy.statusLabels[loan.status] ?? loan.status])} style={styles.rowMain}>
                <ContentIconChip icon="book-check-outline" />
                <View style={styles.rowCopy}>
                  <UiText variant="label">{loan.title ?? loan.barcode ?? loan.copyId}</UiText>
                  <View style={styles.chips}>
                    <StatusChip code={loan.status} labels={copy.statusLabels} />
                  </View>
                  <UiText variant="bodySmall" tone="muted">
                    {joinMeta([
                      `${copy.requestedAt}: ${formatDate(loan.requestedAt)}`,
                      loan.expiresAt ? `${copy.expiresAt}: ${formatDate(loan.expiresAt)}` : null,
                      loan.dueAt ? `${copy.dueAt}: ${formatDate(loan.dueAt)}` : null,
                    ])}
                  </UiText>
                </View>
              </View>
              {isLoanCancellable(loan) ? (
                <Button label={copy.cancel} accessibilityLabel={`${copy.cancel}: ${loan.title ?? loan.barcode ?? ''}`} variant="text" disabled={busy || loans.preview} onPress={() => cancelLoan(loan)} />
              ) : null}
            </Card>
          )}
        />
      )}
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.spacing.sm },
  filterRow: { alignItems: 'flex-start' },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  rowMain: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget },
  chips: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
});
