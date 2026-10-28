import { View } from 'react-native';

import { Card, StatePanel, UiText } from '../../components/Ui';
import type { MobilePublicAnnouncement } from '../../api/client';
import { campusMessages } from '../../i18n/campus-messages';
import { contentApi } from './content-api';
import { joinMeta } from './content-rules';
import { DetailFrame, StatusChip, isPreviewMode, useContentCopy } from './content-ui';
import { previewNews } from './preview-data';
import { htmlToPlainText } from './rich-text';
import { useContentQuery } from './use-content-query';

export interface NewsDetailProps {
  /** Announcement id or slug; also the deep-link parameter. */
  idOrSlug: string;
  onBack: () => void;
}

/** One public announcement. Reads with the public auth policy, so it works signed out too. */
export function NewsDetail({ idOrSlug, onBack }: NewsDetailProps) {
  const { locale, copy: shared, formatDateTime, t } = useContentCopy();
  const copy = campusMessages[locale];
  const preview = isPreviewMode();
  const query = useContentQuery<MobilePublicAnnouncement>(
    `content.news.${idOrSlug}`,
    () => contentApi.newsDetail(idOrSlug),
  );
  const item = preview
    ? previewNews(locale).find((entry) => entry.id === idOrSlug || entry.slug === idOrSlug) ?? null
    : query.data ?? null;

  return (
    <DetailFrame title={copy.newsDetailTitle} onBack={onBack}>
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
      ) : !item ? (
        <StatePanel kind="empty" title={shared.notFound} />
      ) : (
        <Card>
          <UiText accessibilityRole="header" variant="headlineMedium">{item.title}</UiText>
          <View style={{ alignItems: 'flex-start', gap: 8, marginVertical: 8 }}>
            <StatusChip code={item.priority} labels={copy.priorityLabels} />
            <UiText variant="bodySmall" tone="muted">
              {joinMeta([
                item.publishAt ? `${copy.publishedAt}: ${formatDateTime(item.publishAt)}` : null,
                item.lecturerDisplayName ?? item.publishedBy,
                item.semesterName ? `${copy.semester}: ${item.semesterName}` : null,
              ])}
            </UiText>
          </View>
          <UiText variant="bodyMedium">{htmlToPlainText(item.content ?? item.summary)}</UiText>
        </Card>
      )}
    </DetailFrame>
  );
}
