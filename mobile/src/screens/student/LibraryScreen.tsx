import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  DataNotice,
  Divider,
  Field,
  ListRow,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { ResponsiveGrid } from '../../components/ui/ResponsiveGrid';
import {
  ApiClientError,
  apiClient,
  campusApi,
  type MobileLibraryLoan,
  type MobileLibraryTitle,
} from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { libraryMessages, type LibraryLocale } from '../../i18n/library-messages';
import type { MobileScreenProps } from '../../navigation/types';

/**
 * §8 patron library surface (P11): catalogue search, copy holds and own
 * loan history. Staff issue/return stays the web lane; availability is
 * read from the server and every mutation carries Idempotency-Key.
 */
const previewTitles: MobileLibraryTitle[] = [
  {
    id: 'preview-title-1',
    title: 'Nhập môn Cấu trúc dữ liệu',
    author: 'Demo Author',
    category: 'CNTT',
    totalCopies: 3,
    availableCopies: 2,
    version: 1,
  },
  {
    id: 'preview-title-2',
    title: 'Cơ sở dữ liệu nâng cao',
    author: 'Demo Author',
    category: 'CNTT',
    totalCopies: 1,
    availableCopies: 0,
    version: 1,
  },
];

const previewLoans: MobileLibraryLoan[] = [
  {
    id: 'preview-loan-1',
    copyId: 'preview-copy-1',
    barcode: 'BAR-0001',
    title: 'Nhập môn Cấu trúc dữ liệu',
    borrowerUserId: 'preview-user',
    status: 'ISSUED',
    requestedAt: '2026-10-01T00:00:00Z',
    issuedAt: '2026-10-03T00:00:00Z',
    dueAt: '2026-10-17T00:00:00Z',
    version: 3,
    createdAt: '2026-10-01T00:00:00Z',
  },
];

function errorCode(error: unknown): string {
  return error instanceof ApiClientError ? String(error.code ?? '') : '';
}

export function LibraryScreen(_props: MobileScreenProps) {
  const [locale, setLocale] = useState<LibraryLocale>('vi');
  const copy = libraryMessages[locale];
  const statusLabel = (status: string) => copy.statusLabels[status] ?? status;
  const languageSelector = (
    <View style={styles.actionRow}>
      <UiText>{copy.language}</UiText>
      {(['vi', 'en'] as const).map((option) => (
        <Button
          key={option}
          label={option.toUpperCase()}
          accessibilityLabel={option === 'vi' ? 'Tiếng Việt' : 'English'}
          variant={locale === option ? 'primary' : 'secondary'}
          onPress={() => setLocale(option)}
        />
      ))}
    </View>
  );

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [mutating, setMutating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const isPreview = apiClient.mode === 'preview';

  const catalogueQuery = useScreenQuery<MobileLibraryTitle[]>(
    `library.catalogue.${search}`,
    () => campusApi.libraryCatalogue(search || undefined),
    {
      enabled: apiClient.mode === 'live',
      errorMessage: copy.unavailable,
      mapError: () => copy.unavailable,
    },
  );
  const loansQuery = useScreenQuery<MobileLibraryLoan[]>(
    'library.myLoans',
    () => campusApi.libraryMyLoans(),
    {
      enabled: apiClient.mode === 'live',
      errorMessage: copy.unavailable,
      mapError: () => copy.unavailable,
    },
  );

  const titles = isPreview ? previewTitles : catalogueQuery.data ?? [];
  const loans = isPreview ? previewLoans : loansQuery.data ?? [];

  const friendlyError = (error: unknown): string =>
    errorCode(error) === 'NO_COPY' ? copy.noCopiesAvailable : copy.failed;

  const refresh = useCallback(async () => {
    await Promise.all([catalogueQuery.reload(), loansQuery.reload()]);
  }, [catalogueQuery, loansQuery]);

  const run = async (action: () => Promise<unknown>, okMessage: string) => {
    setMutating(true);
    setMutationError(null);
    setNotice(null);
    try {
      await action();
      setNotice(okMessage);
      await refresh();
    } catch (error) {
      setMutationError(friendlyError(error));
    } finally {
      setMutating(false);
    }
  };

  const hold = (title: MobileLibraryTitle) => {
    void run(async () => {
      const detail = await campusApi.libraryTitle(title.id);
      const copyToHold = (detail.copies ?? []).find((item) => item.status === 'AVAILABLE');
      if (!copyToHold) {
        throw new ApiClientError(copy.noCopiesAvailable, 409, '', 'NO_COPY');
      }
      await campusApi.libraryRequest(copyToHold.id);
    }, copy.held);
  };

  const cancel = (loan: MobileLibraryLoan) => {
    void run(() => campusApi.libraryCancel(loan.id, loan.version), copy.cancelled);
  };

  return (
    <ScreenShell
      title={copy.title}
      eyebrow={copy.eyebrow}
      subtitle={copy.subtitle}
      headerAction={languageSelector}
    >
      <DataNotice message={copy.simulatedBanner} />
      {notice ? <DataNotice message={notice} /> : null}
      {mutationError ? <StatePanel kind="error" title={copy.errorTitle} description={mutationError} /> : null}

      <SectionHeading title={copy.catalogue} />
      <Card>
        <Field
          label={copy.search}
          placeholder={copy.searchPlaceholder}
          value={query}
          onChangeText={setQuery}
        />
        <View style={styles.actionRow}>
          <Button
            label={copy.search}
            variant="secondary"
            onPress={() => setSearch(query.trim())}
          />
        </View>
      </Card>
      {catalogueQuery.isLoading && !isPreview ? (
        <StatePanel kind="loading" title={copy.loading} />
      ) : null}
      {catalogueQuery.error != null && !isPreview ? (
        <StatePanel
          kind="error"
          title={copy.errorTitle}
          description={copy.unavailable}
          actionLabel={copy.retry}
          onAction={() => void refresh()}
        />
      ) : null}
      {titles.length === 0 && !catalogueQuery.isLoading ? (
        <Card>
          <UiText variant="label">{copy.emptyCatalogue}</UiText>
        </Card>
      ) : null}
      <ResponsiveGrid>{titles.map((title) => (
        <ListRow
          key={title.id}
          title={title.title}
          subtitle={[title.author, title.category].filter(Boolean).join(' · ')}
          meta={`${title.availableCopies}/${title.totalCopies} ${copy.copiesAvailable}`}
          trailing={(
            <Button
              label={copy.hold}
              variant="secondary"
              loading={mutating}
              disabled={mutating || title.availableCopies <= 0}
              onPress={() => hold(title)}
            />
          )}
        />
      ))}</ResponsiveGrid>

      <SectionHeading title={copy.myLoans} />
      {loansQuery.isLoading && !isPreview ? (
        <StatePanel kind="loading" title={copy.loading} />
      ) : null}
      {loans.length === 0 && !loansQuery.isLoading ? (
        <Card>
          <UiText variant="label">{copy.emptyLoans}</UiText>
        </Card>
      ) : null}
      <ResponsiveGrid>{loans.map((loan) => (
        <Card key={loan.id}>
          <UiText variant="label">{loan.title ?? loan.barcode ?? loan.copyId}</UiText>
          <UiText variant="bodySmall" tone="muted">
            {statusLabel(loan.status)}
            {loan.expiresAt ? ` · ${copy.expiresAt}: ${loan.expiresAt}` : ''}
            {loan.dueAt ? ` · ${copy.dueAt}: ${loan.dueAt}` : ''}
          </UiText>
          {loan.status === 'REQUESTED' || loan.status === 'APPROVED' ? (
            <>
              <Divider />
              <Button
                label={copy.cancel}
                variant="secondary"
                loading={mutating}
                disabled={mutating}
                onPress={() => cancel(loan)}
              />
            </>
          ) : null}
        </Card>
      ))}</ResponsiveGrid>

      <UiText variant="bodySmall" tone="muted">{copy.staffLaneNote}</UiText>
      <ScreenSpacer />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
});
