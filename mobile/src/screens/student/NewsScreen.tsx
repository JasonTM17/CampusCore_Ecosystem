import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  DataNotice,
  Divider,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { ResponsiveGrid } from '../../components/ui/ResponsiveGrid';
import {
  apiClient,
  campusApi,
  type MobilePublicAnnouncement,
} from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { campusMessages, type CampusLocale } from '../../i18n/campus-messages';
import type { MobileScreenProps } from '../../navigation/types';

/**
 * §5 public news lane (P13): the anonymous campus feed — the server
 * restricts it to PUBLISHED, globally-visible announcements so the
 * native surface can never scope a non-public row.
 */
const previewItems: MobilePublicAnnouncement[] = [
  {
    id: 'preview-news-1',
    title: 'Lịch thi cuối kỳ HK1 2025-2026',
    summary: 'Phòng Đào tạo công bố lịch thi cuối kỳ — sinh viên kiểm tra lịch cá nhân.',
    content: 'Lịch thi cuối kỳ HK1 đã được công bố trên cổng thông tin. Sinh viên đăng nhập để xem lịch thi chi tiết theo lớp học phần.',
    priority: 'HIGH',
    publishAt: '2026-10-20T01:00:00Z',
  },
  {
    id: 'preview-news-2',
    title: 'Hội thảo công nghệ sinh viên 2026',
    summary: 'Đăng ký tham gia hội thảo công nghệ do khoa CNTT tổ chức.',
    content: 'Hội thảo công nghệ sinh viên năm 2026 sẽ diễn ra vào tháng 11 tại hội trường A. Sinh viên đăng ký qua cổng sự kiện.',
    priority: 'NORMAL',
    publishAt: '2026-10-18T01:00:00Z',
  },
];

function formatInstant(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function NewsScreen(_props: MobileScreenProps) {
  const [locale, setLocale] = useState<CampusLocale>('vi');
  const copy = campusMessages[locale];
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

  const [expanded, setExpanded] = useState<string | null>(null);
  const isPreview = apiClient.mode === 'preview';
  const feedQuery = useScreenQuery<MobilePublicAnnouncement[]>(
    'campus.news.public',
    async () => (await campusApi.publicAnnouncements(1, 30)).data,
    {
      enabled: apiClient.mode === 'live',
      errorMessage: copy.unavailable,
      mapError: () => copy.unavailable,
    },
  );
  const items = isPreview ? previewItems : feedQuery.data ?? [];
  const warning = !isPreview ? feedQuery.warning : null;

  return (
    <ScreenShell
      title={copy.newsTitle}
      eyebrow={copy.newsEyebrow}
      subtitle={copy.newsSubtitle}
      headerAction={languageSelector}
    >
      {isPreview ? <DataNotice message={copy.simulatedBanner} /> : null}
      {warning ? <DataNotice message={warning} /> : null}

      <SectionHeading title={copy.feed} />
      {feedQuery.isLoading && !isPreview ? (
        <StatePanel kind="loading" title={copy.loading} />
      ) : null}
      {feedQuery.error != null && !isPreview ? (
        <StatePanel
          kind="error"
          title={copy.errorTitle}
          description={copy.unavailable}
          actionLabel={copy.retry}
          onAction={() => void feedQuery.reload()}
        />
      ) : null}
      {items.length === 0 && !feedQuery.isLoading && (isPreview || feedQuery.error == null) ? (
        <Card>
          <UiText variant="label">{copy.emptyFeed}</UiText>
        </Card>
      ) : null}
      <ResponsiveGrid>{items.map((item) => {
        const isOpen = expanded === item.id;
        return (
          <Card key={item.id}>
            <UiText variant="label">{item.title}</UiText>
            <UiText variant="bodySmall" tone="muted">
              {[item.priority ? `${copy.priority}: ${item.priority}` : '',
                item.publishAt ? `${copy.publishedAt}: ${formatInstant(item.publishAt)}` : '',
                item.lecturerDisplayName ?? item.publishedBy ?? '']
                .filter(Boolean).join(' · ')}
            </UiText>
            {item.summary ? (
              <UiText variant="bodySmall">{item.summary}</UiText>
            ) : null}
            {isOpen && item.content ? (
              <>
                <Divider />
                <UiText variant="bodySmall">{item.content}</UiText>
              </>
            ) : null}
            {item.content ? (
              <>
                <Divider />
                <Button
                  label={isOpen ? copy.collapse : copy.readMore}
                  variant="secondary"
                  onPress={() => setExpanded(isOpen ? null : item.id)}
                />
              </>
            ) : null}
          </Card>
        );
      })}</ResponsiveGrid>

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
