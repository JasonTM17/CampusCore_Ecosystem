import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Card, DataNotice, StatePanel, UiText } from '../../components/Ui';
import { FilterChip, IconChip, StatusPill } from '../../components/ui/index';
import { ResponsiveGrid } from '../../components/ui/ResponsiveGrid';
import type { MobilePublicAnnouncement, MobilePublicDoc } from '../../api/client';
import { minTapTarget, tokens } from '../../design/tokens';
import { useTheme, useThemedStyles } from '../../design/theme';
import type { ThemeColors } from '../../design/theme';
import { fillCopy } from '../../i18n/academic-messages';
import { campusMessages } from '../../i18n/campus-messages';
import { useLocale } from '../../i18n/locale-provider';
import { shellMessages } from '../../i18n/shell-messages';
import type { MobileNavigation } from '../../navigation/types';
import { contentApi } from '../content/content-api';
import { docSummary, docTitle } from '../content/docs-model';
import {
  isUrgentPriority,
  joinMeta,
  newsCategoryCode,
  newsCategoryLabel,
  newsTargetOf,
} from '../content/content-rules';
import { previewDocs, previewNews } from '../content/preview-data';
import { formatRelativeTime } from '../content/relative-time';
import { summaryOrExcerpt } from '../content/rich-text';
import { usePagedList } from '../content/use-paged-list';
import { summaryRowAccessibilityLabel } from '../student/summary-label';

/** Web home reads eighteen announcements once and filters them in memory. */
const GUEST_NEWS_MAX = 18;
const GUEST_GALLERY_LIMIT = 6;
const GUEST_DOCS_MAX = 3;

/** Web home category order; labels come from the campus catalogue. */
const GUEST_NEWS_CATEGORIES = [
  'RESEARCH_TECH',
  'AWARDS_HONORS',
  'STUDENT_LIFE',
  'CULTURE_ARTS',
  'ACADEMIC_AFFAIRS',
  'CAREER_OPPORTUNITIES',
] as const;

/**
 * Public magazine feed on the guest landing (web home parity): section copy,
 * category tabs with counts, the featured story, the follow-up stream and the
 * special-feature gallery. Every failure lands only inside this block.
 */
export function GuestNewsTeaser({ navigation }: { navigation: MobileNavigation }) {
  const styles = useThemedStyles(makeStyles);
  const { colors, window } = useTheme();
  const { locale, formatDate } = useLocale();
  const copy = shellMessages[locale].guest;
  const campusCopy = campusMessages[locale];
  const categoryLabels = campusCopy.newsCategoryLabels as Readonly<Record<string, string>>;
  const priorityLabels = campusCopy.priorityLabels as Readonly<Record<string, string>>;
  const preview = useMemo(() => previewNews(locale), [locale]);
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [expanded, setExpanded] = useState(false);
  const list = usePagedList<MobilePublicAnnouncement>({
    key: 'content.news.landing',
    pageSize: GUEST_NEWS_MAX,
    fetchPage: (page, limit, signal) => contentApi.news({ page, limit, signal }),
    keyOf: (item) => item.id,
    preview,
  });
  const counts = useMemo(() => {
    const next: Record<string, number> = {};
    for (const item of list.items) {
      const code = newsCategoryCode(item.categoryId);
      if (code) next[code] = (next[code] ?? 0) + 1;
    }
    return next;
  }, [list.items]);
  const filtered = activeCategory === 'ALL'
    ? list.items
    : list.items.filter((item) => newsCategoryCode(item.categoryId) === activeCategory);
  const featured = filtered[0] ?? null;
  const secondary = filtered.slice(1, 4);
  const gallery = filtered.slice(4);
  const visibleGallery = expanded ? gallery : gallery.slice(0, GUEST_GALLERY_LIMIT);
  const hiddenCount = gallery.length - GUEST_GALLERY_LIMIT;
  const galleryCount = fillCopy(gallery.length === 1 ? copy.articleCountOne : copy.articleCount, { count: gallery.length });
  const expandLabel = expanded
    ? copy.showLess
    : fillCopy(hiddenCount === 1 ? copy.viewMoreOne : copy.viewMore, { count: hiddenCount });
  const open = (item: MobilePublicAnnouncement) => navigation.navigate('news', { newsItem: newsTargetOf(item) });
  const selectCategory = (code: string) => {
    setActiveCategory(code);
    setExpanded(false);
  };
  const galleryCards = visibleGallery.map((item, index) => (
    <GalleryNewsCard
      key={item.id}
      category={newsCategoryLabel(categoryLabels, item.categoryId)}
      date={item.publishAt ? formatDate(item.publishAt) : ''}
      index={index}
      item={item}
      onPress={() => open(item)}
      readLabel={copy.readArticle}
      summary={summaryOrExcerpt(item)}
    />
  ));

  return (
    <View style={styles.section} testID="guest-news-section">
      <View style={styles.head}>
        <View style={styles.headCopy}>
          <UiText variant="meta" tone="primary" style={styles.eyebrow}>{copy.newsEyebrow}</UiText>
          <UiText accessibilityRole="header" variant="headlineMedium">{copy.newsTitle}</UiText>
          <UiText variant="bodySmall" tone="muted">{copy.newsDescription}</UiText>
        </View>
        <Pressable
          accessibilityLabel={copy.seeAll}
          accessibilityRole="link"
          onPress={() => navigation.navigate('news')}
          style={styles.seeAll}
          testID="guest-news-see-all"
        >
          <UiText variant="label" tone="primary">{copy.seeAll}</UiText>
          <MaterialCommunityIcons accessible={false} color={colors.primary} importantForAccessibility="no" name="arrow-right" size={18} />
        </Pressable>
      </View>
      {list.items.length > 0 && !list.loading && !list.error ? (
        <View style={styles.categories}>
          <FilterChip
            count={list.items.length}
            label={copy.allStories}
            onPress={() => selectCategory('ALL')}
            selected={activeCategory === 'ALL'}
          />
          {GUEST_NEWS_CATEGORIES.map((code) => (
            <FilterChip
              count={counts[code] ?? 0}
              key={code}
              label={categoryLabels[code] ?? code}
              onPress={() => selectCategory(code)}
              selected={activeCategory === code}
            />
          ))}
        </View>
      ) : null}
      {list.warning ? <DataNotice message={list.warning} /> : null}
      {list.loading ? (
        <StatePanel kind="loading" />
      ) : list.error ? (
        <View testID="guest-news-error">
          <StatePanel
            actionLabel={copy.retry}
            description={copy.newsErrorDescription}
            kind="error"
            onAction={() => void list.reload()}
            title={copy.newsErrorTitle}
          />
        </View>
      ) : !featured ? (
        <View testID="guest-news-empty">
          <StatePanel description={copy.newsEmptyDescription} kind="empty" title={copy.empty} />
        </View>
      ) : (
        <View style={styles.feed}>
          <FeaturedNewsCard
            category={newsCategoryLabel(categoryLabels, featured.categoryId)}
            date={featured.publishAt ? formatDate(featured.publishAt) : ''}
            item={featured}
            onPress={() => open(featured)}
            readLabel={copy.readArticle}
            summary={summaryOrExcerpt(featured)}
          />
          {secondary.map((item) => (
            <CompactNewsRow
              date={item.publishAt ? formatDate(item.publishAt) : ''}
              item={item}
              key={item.id}
              onPress={() => open(item)}
              urgentLabel={isUrgentPriority(item.priority) ? priorityLabels.URGENT : ''}
            />
          ))}
          {gallery.length > 0 ? (
            <View style={styles.gallery} testID="guest-news-gallery">
              <View style={styles.galleryHead}>
                <MaterialCommunityIcons accessible={false} color={colors.primary} importantForAccessibility="no" name="star-four-points-outline" size={18} />
                <UiText accessibilityRole="header" variant="headlineSmall" style={styles.galleryTitle}>{copy.specialFeatures}</UiText>
                <UiText variant="meta" tone="muted">{galleryCount}</UiText>
              </View>
              {window.fontScale >= 1.3 ? (
                <View style={styles.feed}>{galleryCards}</View>
              ) : (
                <ResponsiveGrid>{galleryCards}</ResponsiveGrid>
              )}
              {gallery.length > GUEST_GALLERY_LIMIT ? (
                <Pressable
                  accessibilityLabel={expandLabel}
                  accessibilityRole="button"
                  onPress={() => setExpanded((current) => !current)}
                  style={styles.expand}
                  testID="guest-news-expand"
                >
                  <UiText variant="label">{expandLabel}</UiText>
                  <MaterialCommunityIcons
                    accessible={false}
                    color={colors.text}
                    importantForAccessibility="no"
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                  />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

/**
 * Public documents teaser (web `/docs` titles and unpublished-failure copy).
 * The rows are a read-only snapshot; the section action opens the docs screen.
 */
export function GuestDocsTeaser({ navigation }: { navigation: MobileNavigation }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { locale } = useLocale();
  const copy = shellMessages[locale].guest;
  const campusCopy = campusMessages[locale];
  const preview = useMemo(() => previewDocs(locale), [locale]);
  const list = usePagedList<MobilePublicDoc>({
    key: 'content.docs.landing',
    pageSize: GUEST_DOCS_MAX,
    fetchPage: (page, limit, signal) => contentApi.docs({ page, limit, signal }),
    keyOf: (item) => item.slug,
    preview,
  });
  const docs = list.items.slice(0, GUEST_DOCS_MAX);

  return (
    <View style={styles.section} testID="guest-docs-section">
      <View style={styles.head}>
        <View style={styles.headCopy}>
          <UiText variant="meta" tone="primary" style={styles.eyebrow}>CampusUTE</UiText>
          <UiText accessibilityRole="header" variant="headlineMedium">{shellMessages[locale].screens.docs}</UiText>
          <UiText variant="bodySmall" tone="muted">{copy.docsDescription}</UiText>
        </View>
        <Pressable
          accessibilityLabel={copy.docsSeeAll}
          accessibilityRole="link"
          onPress={() => navigation.navigate('docs')}
          style={styles.seeAll}
          testID="guest-docs-see-all"
        >
          <UiText variant="label" tone="primary">{copy.docsSeeAll}</UiText>
          <MaterialCommunityIcons accessible={false} color={colors.primary} importantForAccessibility="no" name="arrow-right" size={18} />
        </Pressable>
      </View>
      {list.warning ? <DataNotice message={list.warning} /> : null}
      {list.loading ? (
        <StatePanel kind="loading" />
      ) : list.error ? (
        <View testID="guest-docs-error">
          <StatePanel
            actionLabel={copy.retry}
            description={copy.docsErrorDescription}
            kind="error"
            onAction={() => void list.reload()}
            title={copy.docsErrorTitle}
          />
        </View>
      ) : docs.length === 0 ? (
        <StatePanel kind="empty" title={campusCopy.emptyDocs} />
      ) : (
        <View style={styles.feed}>
          {docs.map((doc) => {
            const summary = docSummary(doc, locale);
            const published = doc.publishedAt ? formatRelativeTime(doc.publishedAt, locale) : '';
            return (
              <Card key={doc.slug} style={styles.docCard}>
                <View style={styles.docRow}>
                  <IconChip icon="file-document-outline" size={36} />
                  <View style={styles.docCopy}>
                    <UiText variant="label">{docTitle(doc, locale)}</UiText>
                    {summary ? <UiText ellipsizeMode="tail" numberOfLines={2} variant="bodySmall" tone="muted">{summary}</UiText> : null}
                    <View style={styles.metaRow}>
                      <StatusPill label={fillCopy(campusCopy.revision, { n: doc.publishedRevision })} tone="primary" />
                      {published ? <UiText variant="meta" tone="muted">{published}</UiText> : null}
                    </View>
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </View>
  );
}

function NewsCover({ url, testID }: { url?: string | null; testID?: string }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <View importantForAccessibility="no" style={[styles.cover, styles.coverPlaceholder]} testID={testID ? `${testID}-placeholder` : undefined}>
        <MaterialCommunityIcons accessible={false} color={colors.textMuted} name="newspaper-variant-outline" size={32} />
      </View>
    );
  }
  return (
    <Image
      accessible={false}
      importantForAccessibility="no"
      onError={() => setFailed(true)}
      resizeMode="cover"
      source={{ uri: url }}
      style={styles.cover}
      testID={testID}
    />
  );
}

function FeaturedNewsCard({
  item,
  category,
  date,
  summary,
  readLabel,
  onPress,
}: {
  item: MobilePublicAnnouncement;
  category: string;
  date: string;
  summary: string;
  readLabel: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={summaryRowAccessibilityLabel({
        title: item.title,
        badge: category,
        date,
        summary,
      })}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [pressed ? styles.pressed : undefined]}
      testID="guest-news-featured"
    >
      <Card style={styles.featuredCard}>
        <NewsCover key={item.coverImageUrl ?? 'none'} testID="guest-news-cover" url={item.coverImageUrl} />
        <View style={styles.featuredBody}>
          <View style={styles.metaRow}>
            {category ? <StatusPill label={category} tone="primary" /> : null}
            {date ? <UiText variant="meta" tone="muted">{date}</UiText> : null}
          </View>
          <UiText variant="label">{item.title}</UiText>
          {summary ? <UiText ellipsizeMode="tail" numberOfLines={2} variant="bodySmall" tone="muted">{summary}</UiText> : null}
          <View style={styles.readRow}>
            <UiText variant="label" tone="primary">{readLabel}</UiText>
            <MaterialCommunityIcons accessible={false} color={colors.primary} importantForAccessibility="no" name="chevron-right" size={18} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function CompactNewsRow({
  item,
  date,
  urgentLabel,
  onPress,
}: {
  item: MobilePublicAnnouncement;
  date: string;
  urgentLabel: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={joinMeta([item.title, urgentLabel, date])}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.surfaceLow } : undefined]}
    >
      <View style={styles.rowCopy}>
        <UiText variant="label">{item.title}</UiText>
        <View style={styles.metaRow}>
          {urgentLabel ? <StatusPill label={urgentLabel} tone="error" /> : null}
          {date ? <UiText variant="meta" tone="muted">{date}</UiText> : null}
        </View>
      </View>
      <MaterialCommunityIcons accessible={false} color={colors.textMuted} importantForAccessibility="no" name="chevron-right" size={20} />
    </Pressable>
  );
}

function GalleryNewsCard({
  item,
  index,
  category,
  date,
  summary,
  readLabel,
  onPress,
}: {
  item: MobilePublicAnnouncement;
  index: number;
  category: string;
  date: string;
  summary: string;
  readLabel: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={summaryRowAccessibilityLabel({
        title: item.title,
        badge: category,
        date,
        summary,
      })}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [pressed ? styles.pressed : undefined]}
      testID={`guest-news-gallery-${index}`}
    >
      <Card style={styles.galleryCard}>
        <NewsCover key={item.coverImageUrl ?? 'none'} url={item.coverImageUrl} />
        <View style={styles.galleryBody}>
          <View style={styles.metaRow}>
            {category ? <StatusPill label={category} tone="primary" /> : null}
            {date ? <UiText variant="meta" tone="muted">{date}</UiText> : null}
          </View>
          <UiText variant="label">{item.title}</UiText>
          {summary ? <UiText ellipsizeMode="tail" numberOfLines={2} variant="bodySmall" tone="muted">{summary}</UiText> : null}
          <View style={styles.readRow}>
            <UiText variant="label" tone="primary">{readLabel}</UiText>
            <MaterialCommunityIcons accessible={false} color={colors.primary} importantForAccessibility="no" name="arrow-right" size={16} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  section: { gap: tokens.spacing.sm },
  head: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  headCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  eyebrow: { letterSpacing: 0.6, textTransform: 'uppercase' },
  seeAll: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.xs, minHeight: minTapTarget, minWidth: minTapTarget },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  feed: { gap: tokens.spacing.sm },
  featuredCard: { overflow: 'hidden', padding: 0 },
  cover: { height: 170, width: '100%' },
  coverPlaceholder: { alignItems: 'center', backgroundColor: colors.surfaceLow, justifyContent: 'center' },
  featuredBody: { gap: tokens.spacing.xs, padding: tokens.spacing.md },
  metaRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  readRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.xs, marginTop: tokens.spacing.xs },
  row: { alignItems: 'center', borderRadius: tokens.radii.control, flexDirection: 'row', gap: tokens.spacing.sm, minHeight: minTapTarget, minWidth: minTapTarget, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.xs },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  gallery: { gap: tokens.spacing.sm, marginTop: tokens.spacing.sm },
  galleryHead: { alignItems: 'center', borderTopColor: colors.outlineVariant, borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs, paddingTop: tokens.spacing.md },
  galleryTitle: { flex: 1, minWidth: 0 },
  galleryCard: { overflow: 'hidden', padding: 0 },
  galleryBody: { gap: tokens.spacing.xs, padding: tokens.spacing.md },
  expand: { alignItems: 'center', alignSelf: 'center', borderColor: colors.outlineVariant, borderRadius: tokens.radii.control, borderWidth: 1, flexDirection: 'row', gap: tokens.spacing.xs, minHeight: minTapTarget, paddingHorizontal: tokens.spacing.md, paddingVertical: tokens.spacing.sm },
  docCard: { gap: tokens.spacing.sm },
  docRow: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm },
  docCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  pressed: { opacity: 0.88 },
});
