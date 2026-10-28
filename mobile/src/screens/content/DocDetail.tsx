import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, StatePanel, UiText } from '../../components/Ui';
import { ChoiceField, Notice } from '../../components/ui/index';
import type { MobilePublicDoc } from '../../api/client';
import { campusMessages } from '../../i18n/campus-messages';
import { fillCopy } from '../../i18n/academic-messages';
import { contentApi } from './content-api';
import { joinMeta } from './content-rules';
import { DetailFrame, isPreviewMode, useContentCopy } from './content-ui';
import { previewDocs } from './preview-data';
import { htmlToPlainText } from './rich-text';
import { revisionNumbers, docBody, docTitle } from './docs-model';
import { useContentQuery } from './use-content-query';

export interface DocDetailProps {
  slug: string;
  onBack: () => void;
}

type DocRecord = MobilePublicDoc & { superseded?: boolean };

/** A published document pinned to its published revision, with permalinked earlier revisions. */
export function DocDetail({ slug, onBack }: DocDetailProps) {
  const { locale, copy: shared, formatDateTime, t } = useContentCopy();
  const copy = campusMessages[locale];
  const preview = isPreviewMode();
  const [revision, setRevision] = useState<number | null>(null);

  const query = useContentQuery<DocRecord>(
    `content.doc.${slug}.${revision ?? 'current'}`,
    () => (revision === null ? contentApi.docDetail(slug) : contentApi.docRevision(slug, revision)),
  );
  const doc: DocRecord | null = preview
    ? previewDocs(locale).find((entry) => entry.slug === slug) ?? null
    : query.data ?? null;
  const shown = revision ?? doc?.publishedRevision ?? null;
  const viewingOld = doc !== null && revision !== null && revision !== doc.publishedRevision;

  return (
    <DetailFrame title={copy.docDetailTitle} onBack={onBack}>
      {!preview && query.isLoading ? (
        <StatePanel kind="loading" title={t('loading')} />
      ) : !preview && query.error ? (
        <StatePanel
          kind="error"
          title={shared.errorTitle}
          description={query.error}
          actionLabel={t('retry')}
          onAction={() => void query.reload()}
        />
      ) : !doc ? (
        <StatePanel kind="empty" title={shared.notFound} />
      ) : (
        <View style={{ gap: 12 }}>
          {viewingOld ? (
            <Notice
              tone="warning"
              message={fillCopy(copy.supersededNote, { n: shown ?? '', current: doc.publishedRevision })}
              actionLabel={copy.openCurrent}
              onAction={() => setRevision(null)}
            />
          ) : null}
          <Card>
            <UiText accessibilityRole="header" variant="headlineMedium">{docTitle(doc, locale)}</UiText>
            <UiText variant="bodySmall" tone="muted" style={{ marginVertical: 8 }}>
              {joinMeta([
                shown !== null ? fillCopy(copy.revision, { n: shown }) : null,
                doc.publishedAt ? `${copy.publishedAt}: ${formatDateTime(doc.publishedAt)}` : null,
                doc.categoryId ? `${copy.category}: ${doc.categoryId}` : null,
                (doc.tagIds ?? []).length > 0 ? `${copy.tags}: ${(doc.tagIds ?? []).join(', ')}` : null,
              ])}
            </UiText>
            <UiText variant="bodyMedium">{htmlToPlainText(docBody(doc, locale))}</UiText>
          </Card>
          {doc.publishedRevision > 1 ? (
            <ChoiceField
              label={copy.revisions}
              display="sheet"
              value={String(shown ?? doc.publishedRevision)}
              options={revisionNumbers(doc.publishedRevision).map((n) => ({ value: String(n), label: fillCopy(copy.revision, { n }) }))}
              onChange={(value) => setRevision(Number(value) === doc.publishedRevision ? null : Number(value))}
            />
          ) : null}
          {viewingOld ? <Button label={copy.openCurrent} variant="secondary" onPress={() => setRevision(null)} /> : null}
        </View>
      )}
    </DetailFrame>
  );
}
