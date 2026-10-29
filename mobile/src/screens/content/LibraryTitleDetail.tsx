import { StyleSheet, View } from 'react-native';

import { Button, Card, StatePanel, UiText } from '../../components/Ui';
import { StatusPill } from '../../components/ui/index';
import type { MobileLibraryTitle } from '../../api/client';
import { fillCopy } from '../../i18n/academic-messages';
import { libraryMessages } from '../../i18n/library-messages';
import { contentApi } from './content-api';
import { firstAvailableCopy, joinMeta } from './content-rules';
import { ContentHero, ContentIconChip, DetailFrame, FlashNotice, MetaRow, StatusChip, isPreviewMode, useContentCopy, type Flash } from './content-ui';
import { previewLibraryTitles } from './preview-data';
import { useContentQuery } from './use-content-query';

export interface LibraryTitleDetailProps {
  titleId: string;
  busy: boolean;
  flash: Flash | null;
  onBack: () => void;
  /** Called with the title that carries the copy to hold. */
  onHold: (title: MobileLibraryTitle) => void;
  reloadToken: number;
}

/** Title detail with its copies; the hold goes to the first copy the server lists as available. */
export function LibraryTitleDetail({ titleId, busy, flash, onBack, onHold, reloadToken }: LibraryTitleDetailProps) {
  const { locale, copy: shared, formatNumber, t } = useContentCopy();
  const copy = libraryMessages[locale];
  const preview = isPreviewMode();
  const query = useContentQuery<MobileLibraryTitle>(`content.library.title.${titleId}.${reloadToken}`, () => contentApi.libraryTitle(titleId));
  const title = preview ? previewLibraryTitles(locale).find((entry) => entry.id === titleId) ?? null : query.data ?? null;
  const copies = title?.copies ?? [];
  const canHold = title !== null && !preview && firstAvailableCopy(copies) !== null;

  return (
    <DetailFrame title={copy.title} onBack={onBack}>
      {!preview && query.isLoading ? (
        <StatePanel kind="loading" title={t('loading')} />
      ) : !preview && query.error ? (
        <StatePanel kind="error" title={shared.errorTitle} description={query.error} actionLabel={t('retry')} onAction={() => void query.reload()} />
      ) : !title ? (
        <StatePanel kind="empty" title={shared.notFound} />
      ) : (
        <View style={{ gap: 12 }}>
          <FlashNotice flash={flash} />
          <Card>
            <ContentHero title={title.title} icon="book-open-page-variant-outline" detail={joinMeta([title.author, title.publisher, title.publishedYear ? String(title.publishedYear) : null])}>
              <View style={styles.heroPills}>
                <StatusPill
                  label={fillCopy(copy.copiesAvailable, { available: formatNumber(title.availableCopies), total: formatNumber(title.totalCopies) })}
                  tone={title.availableCopies > 0 ? 'success' : 'warning'}
                />
              </View>
            </ContentHero>
            <View style={{ gap: 4, marginTop: 8 }}>
              <MetaRow label={copy.author} value={title.author} />
              <MetaRow label={copy.publisher} value={title.publisher} />
              <MetaRow label={copy.year} value={title.publishedYear ? String(title.publishedYear) : null} />
              <MetaRow label={copy.category} value={title.category} />
              <MetaRow label="ISBN" value={title.isbn} />
              <MetaRow
                label={copy.availability}
                value={fillCopy(copy.copiesAvailable, { available: formatNumber(title.availableCopies), total: formatNumber(title.totalCopies) })}
              />
            </View>
            {title.description ? <UiText variant="bodyMedium" style={{ marginTop: 8 }}>{title.description}</UiText> : null}
          </Card>
          {copies.length > 0 ? (
            <Card>
              <UiText accessibilityRole="header" variant="headlineSmall">{copy.copies}</UiText>
              {copies.map((entry) => (
                <View key={entry.id} accessible accessibilityLabel={`${entry.barcode}, ${copy.copyStatus[entry.status] ?? entry.status}`} style={styles.copyRow}>
                  <ContentIconChip icon="barcode-scan" />
                  <UiText variant="bodyMedium" style={{ flex: 1 }}>{entry.barcode}</UiText>
                  <StatusChip code={entry.status} labels={copy.copyStatus} />
                </View>
              ))}
            </Card>
          ) : null}
          {title.availableCopies > 0 || canHold ? (
            <Button label={copy.hold} loading={busy} disabled={busy || preview || !canHold} onPress={() => onHold(title)} />
          ) : (
            <UiText variant="label" tone="warning">{copy.noCopiesAvailable}</UiText>
          )}
        </View>
      )}
    </DetailFrame>
  );
}

const styles = StyleSheet.create({
  heroPills: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  copyRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, minHeight: 44, paddingVertical: 4 },
});
