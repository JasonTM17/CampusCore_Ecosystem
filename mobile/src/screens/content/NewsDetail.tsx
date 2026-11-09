import { StyleSheet, View } from 'react-native';

import { Card, StatePanel } from '../../components/Ui';
import type { MobilePublicAnnouncement } from '../../api/client';
import { campusMessages } from '../../i18n/campus-messages';
import { contentApi } from './content-api';
import { joinMeta, publisherName } from './content-rules';
import { ContentHero, DetailFrame, StatusChip, isPreviewMode, useContentCopy } from './content-ui';
import { previewNews } from './preview-data';
import { formatRelativeTime } from './relative-time';
import { RichContent } from '../../components/content/rich-content';
import { useContentQuery } from './use-content-query';

export interface NewsDetailProps {
  /** Announcement id or slug; also the deep-link parameter. */
  idOrSlug: string;
  onBack: () => void;
}

/** One public announcement. Reads with the public auth policy, so it works signed out too. */
export function NewsDetail({ idOrSlug, onBack }: NewsDetailProps) {
  const { locale, t } = useContentCopy();
  const copy = campusMessages[locale];
  const preview = isPreviewMode();
  const query = useContentQuery<MobilePublicAnnouncement>(
    `content.news.${idOrSlug}`,
    () => contentApi.newsDetail(idOrSlug),
  );
  const item = preview
    ? previewNews(locale).find((entry) => entry.id === idOrSlug || entry.slug === idOrSlug) ?? null
    : query.data ?? null;
  const publishedDate = item?.publishAt ?? item?.createdAt ?? null;
  const publishedLabel = publishedDate
    ? copy.publishedOn.replace('{date}', formatRelativeTime(publishedDate, locale))
    : null;

  return (
    <DetailFrame title={copy.newsTitle} backLabel={copy.newsBackToList} onBack={onBack}>
      {!preview && query.isLoading ? (
        <StatePanel kind="loading" title={t('loading')} />
      ) : !preview && query.error ? (
        query.errorStatus === 404 ? (
          <StatePanel kind="empty" title={copy.newsNotFoundTitle} description={copy.newsNotFoundBody} />
        ) : (
          <StatePanel
            kind="error"
            title={copy.newsLoadErrorTitle}
            description={copy.newsLoadError}
            actionLabel={t('retry')}
            onAction={() => void query.reload()}
          />
        )
      ) : !item ? (
        <StatePanel kind="empty" title={copy.newsNotFoundTitle} description={copy.newsNotFoundBody} />
      ) : (
        <Card>
          <ContentHero
            title={item.title}
            icon="newspaper-variant-outline"
            detail={joinMeta([
              publishedLabel,
              publisherName(item.lecturerDisplayName, item.publishedBy),
              item.semesterName ? `${copy.semester}: ${item.semesterName}` : null,
            ])}
          >
            <View style={styles.heroPills}>
              <StatusChip code={item.priority} labels={copy.priorityLabels} />
            </View>
          </ContentHero>
          <RichContent html={item.content ?? item.summary} style={styles.body} />
        </Card>
      )}
    </DetailFrame>
  );
}

const styles = StyleSheet.create({
  heroPills: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  body: { marginTop: 16 },
});
