import { useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { Button, Card, StatePanel } from '../../components/Ui';
import { ChoiceField, Notice, StatusPill } from '../../components/ui/index';
import type { MobilePublicDoc } from '../../api/client';
import { campusMessages } from '../../i18n/campus-messages';
import { fillCopy } from '../../i18n/academic-messages';
import { contentApi } from './content-api';
import { joinMeta } from './content-rules';
import { ContentHero, DetailFrame, isPreviewMode, useContentCopy } from './content-ui';
import { previewDocs } from './preview-data';
import { formatRelativeTime } from './relative-time';
import { RichContent } from '../../components/content/rich-content';
import { revisionNumbers, docBody, docCategoryLabel, docTitle } from './docs-model';
import { useContentQuery } from './use-content-query';

export interface DocDetailProps {
  slug: string;
  onBack: () => void;
  initialRevision?: number | null;
}

type DocRecord = MobilePublicDoc & { superseded?: boolean };

/** A published document pinned to its published revision, with permalinked earlier revisions. */
export function DocDetail({ slug, onBack, initialRevision = null }: DocDetailProps) {
  const { locale, t } = useContentCopy();
  const copy = campusMessages[locale];
  const categoryLabels = copy.docCategoryLabels as Readonly<Record<string, string>>;
  const preview = isPreviewMode();
  const [revision, setRevision] = useState<number | null>(initialRevision);

  useEffect(() => setRevision(initialRevision), [slug, initialRevision]);

  const query = useContentQuery<DocRecord>(
    `content.doc.${slug}.${revision ?? 'current'}`,
    () => (revision === null ? contentApi.docDetail(slug) : contentApi.docRevision(slug, revision)),
  );
  const doc: DocRecord | null = preview
    ? previewDocs(locale).find((entry) => entry.slug === slug) ?? null
    : query.data ?? null;
  const shown = revision ?? doc?.publishedRevision ?? null;
  const viewingOld = doc !== null && revision !== null && revision !== doc.publishedRevision;
  const categoryLabel = doc?.categoryId ? docCategoryLabel(doc.categoryId, categoryLabels) : undefined;
  const publishedLabel = doc?.publishedAt
    ? copy.publishedOn.replace('{date}', formatRelativeTime(doc.publishedAt, locale))
    : null;
  const revisionLabel = shown !== null ? fillCopy(copy.revision, { n: shown }) : null;
  const sharePermalink = () => {
    if (!doc) return;
    const url = `https://www.campusute.io.vn/docs/${encodeURIComponent(slug)}?rev=${doc.publishedRevision}`;
    void Share.share({ message: url, url }).catch(() => undefined);
  };

  return (
    <DetailFrame title={copy.docsTitle} backLabel={copy.docsBackToList} onBack={onBack}>
      {!preview && query.isLoading ? (
        <StatePanel kind="loading" title={t('loading')} />
      ) : !preview && query.error ? (
        query.errorStatus === 404 ? (
          <StatePanel kind="empty" title={copy.docsNotFoundTitle} description={copy.docsNotFoundBody} />
        ) : (
          <StatePanel
            kind="error"
            title={copy.docsLoadErrorTitle}
            description={copy.docsLoadError}
            actionLabel={t('retry')}
            onAction={() => void query.reload()}
          />
        )
      ) : !doc ? (
        <StatePanel kind="empty" title={copy.docsNotFoundTitle} description={copy.docsNotFoundBody} />
      ) : (
        <View style={{ gap: 12 }}>
          {viewingOld ? (
            <Notice
              tone="warning"
              message={fillCopy(copy.supersededNote, { current: doc.publishedRevision })}
              actionLabel={copy.open}
              onAction={() => setRevision(null)}
            />
          ) : null}
          <Card>
            <ContentHero
              title={docTitle(doc, locale)}
              icon="file-document-outline"
              detail={joinMeta([
                publishedLabel,
                revisionLabel,
                categoryLabel ? `${copy.category}: ${categoryLabel}` : null,
              ])}
            >
              <View style={styles.heroPills}>
                {revisionLabel ? <StatusPill label={revisionLabel} tone="primary" /> : null}
              </View>
            </ContentHero>
            {!viewingOld ? (
              <Button label={copy.permalinkLabel} variant="text" onPress={sharePermalink} />
            ) : null}
            <RichContent html={docBody(doc, locale)} style={styles.body} />
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
        </View>
      )}
    </DetailFrame>
  );
}

const styles = StyleSheet.create({
  heroPills: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  body: { marginTop: 16 },
});
