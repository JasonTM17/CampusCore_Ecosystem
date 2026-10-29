import { useContext, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, Card, DataNotice, StatePanel, UiText } from '../../components/Ui';
import { StatusPill } from '../../components/ui/index';
import { apiClient } from '../../api/client';
import type { MobilePublicAnnouncement } from '../../api/client';
import { signInWithOidc } from '../../auth/oidc-session';
import { sessionStore } from '../../auth/mobile-session-store';
import { tokens } from '../../design/tokens';
import { chromeFor } from '../../design/chrome';
import { useThemedStyles, useTheme } from '../../design/theme';
import type { ThemeColors } from '../../design/theme';
import { accountMessages } from '../../i18n/account-messages';
import { campusMessages } from '../../i18n/campus-messages';
import { useLocale } from '../../i18n/locale-provider';
import { shellMessages } from '../../i18n/shell-messages';
import { useSession } from '../../session/SessionContext';
import { accountScreen } from '../account/account-routes';
import { contentApi } from '../content/content-api';
import {
  isUrgentPriority,
  joinMeta,
  newsCategoryLabel,
  newsHighlights,
  newsTargetOf,
} from '../content/content-rules';
import { previewNews } from '../content/preview-data';
import { summaryOrExcerpt } from '../content/rich-text';
import { usePagedList } from '../content/use-paged-list';
import type { MobileScreenProps } from '../../navigation/types';

const copyByLocale = {
  en: {
    title: 'Welcome back',
    portal: 'Academic information portal',
    heading: 'Sign in',
    preview: 'Preview build — explore with a local pseudo-session.',
    live: 'Continue in your browser with CampusUTE ID. Your credentials never touch this app.',
    explore: 'Explore preview',
    signIn: 'Sign in with CampusUTE ID',
    unreachable: 'Sign-in could not reach the CampusUTE identity service.',
  },
  vi: {
    title: 'Chào mừng trở lại',
    portal: 'Cổng thông tin đào tạo',
    heading: 'Đăng nhập',
    preview: 'Bản xem thử — khám phá bằng phiên cục bộ.',
    live: 'Tiếp tục trong trình duyệt với CampusUTE ID. Thông tin đăng nhập không đi qua ứng dụng này.',
    explore: 'Khám phá bản xem thử',
    signIn: 'Đăng nhập bằng CampusUTE ID',
    unreachable: 'Không kết nối được dịch vụ định danh CampusUTE.',
  },
} as const;

/** How far the form card rides up over the navy hero band. */
const HERO_OVERLAP = tokens.spacing.lg + tokens.spacing.xs;

/**
 * OIDC sign-in (mobile-policy §3): the system browser owns credentials —
 * this screen never sees a credential. Preview mode keeps the local
 * pseudo-session entry (KM-9: memory-only, never SecureStore).
 */
export function SignInScreen({ navigation }: MobileScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const { scheme, window } = useTheme();
  const chrome = chromeFor(scheme);
  const session = useSession();
  const { locale } = useLocale();
  const copy = copyByLocale[locale];
  const insets = useContext(SafeAreaInsetsContext);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isPreview = apiClient.mode === 'preview';
  const stackGuests = window.fontScale >= 1.3;

  const handleSignIn = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const outcome = await signInWithOidc({ issuer: sessionStoreIssuer() });
      if (outcome.kind === 'cancelled') {
        return;
      }
      if (outcome.kind === 'blocked') {
        session.markBlocked(outcome.reason);
        return;
      }
      await sessionStore.saveRefresh(outcome.refreshToken);
      sessionStore.setAccessToken(outcome.accessToken);
      sessionStore.bumpEpoch();
      navigation.completeSignIn(outcome.role, outcome.accountId);
    } catch {
      setError(copy.unreachable);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={chrome.surface} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tokens.spacing.xl + (insets?.bottom ?? 0) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { backgroundColor: chrome.surface, paddingTop: (insets?.top ?? 0) + tokens.spacing.lg }]}>
          <View style={styles.brandRow}>
            <Image accessibilityLabel="HCMUTE" accessibilityRole="image" source={require('../../../assets/hcmute-logo.png')} resizeMode="contain" style={styles.brandMark} />
            <View style={styles.brandCopy}>
              <UiText variant="headlineMedium" style={{ color: chrome.onSurface }}>CampusUTE</UiText>
              <UiText variant="bodySmall" style={{ color: chrome.onSurfaceMuted }}>{copy.portal}</UiText>
            </View>
          </View>
          <UiText variant="headlineMedium" style={[styles.heroTitle, { color: chrome.onSurface }]}>{copy.title}</UiText>
        </View>
        <View style={styles.body}>
          <Card style={styles.formCard}>
            <UiText accessibilityRole="header" variant="headlineLarge">{copy.heading}</UiText>
            <UiText variant="bodySmall" tone="muted" style={styles.formIntro}>
              {isPreview ? copy.preview : copy.live}
            </UiText>
            {isPreview ? (
              <Button icon="arrow-right" label={copy.explore} onPress={() => navigation.enterPreview()} style={styles.submit} />
            ) : (
              <Button
                label={copy.signIn}
                icon="login"
                loading={isSubmitting}
                onPress={handleSignIn}
                style={styles.submit}
              />
            )}
            {isPreview ? null : (
              <Button
                label={accountMessages[locale].forgot.title}
                onPress={() => navigation.navigate(accountScreen('forgotPassword'))}
                variant="text"
              />
            )}
            {error ? (
              <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.errorPanel}>
                <UiText variant="bodySmall" tone="error">
                  {error}
                </UiText>
              </View>
            ) : null}
          </Card>
          <View style={stackGuests ? styles.guestColumn : styles.guestRow}>
            <Button icon="newspaper-variant-outline" label={shellMessages[locale].screens.news} onPress={() => navigation.navigate('news')} variant="secondary" style={stackGuests ? undefined : styles.guestButton} />
            <Button icon="file-document-outline" label={shellMessages[locale].screens.docs} onPress={() => navigation.navigate('docs')} variant="secondary" style={stackGuests ? undefined : styles.guestButton} />
          </View>
          <SignInNewsSection navigation={navigation} />
          <View style={styles.footerFlex} />
        </View>
      </ScrollView>
    </View>
  );
}

function sessionStoreIssuer(): string {
  // The store already resolves EXPO_PUBLIC_ISSUER_URL → platform default
  // (KM-2); the flow must target the same origin the refresh calls use.
  return sessionStore.issuer;
}

/* ---------- guest news feed ---------- */

/** Lead article plus the compact follow-up rows shown under it. */
const GUEST_NEWS_MAX = 5;

/**
 * Public magazine feed under the guest actions (web home parity). It reuses the
 * same anonymous paged read and per-identity memory cache as the /news screen,
 * so a guest who opens the feed twice gets stale-while-revalidate for free.
 * Every failure lands only inside this section — the sign-in controls never
 * wait for it.
 */
function SignInNewsSection({ navigation }: { navigation: MobileScreenProps['navigation'] }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeNewsStyles);
  const { locale, formatDate } = useLocale();
  const copy = shellMessages[locale].guest;
  const campusCopy = campusMessages[locale];
  const categoryLabels = campusCopy.newsCategoryLabels as Readonly<Record<string, string>>;
  const priorityLabels = campusCopy.priorityLabels as Readonly<Record<string, string>>;
  const preview = useMemo(() => previewNews(locale), [locale]);
  const list = usePagedList<MobilePublicAnnouncement>({
    key: 'content.news',
    fetchPage: (page, limit, signal) => contentApi.news({ page, limit, signal }),
    keyOf: (item) => item.id,
    preview,
  });
  const { featured, rest } = newsHighlights(list.items, GUEST_NEWS_MAX);
  const open = (item: MobilePublicAnnouncement) => navigation.navigate('news', { newsItem: newsTargetOf(item) });

  return (
    <View style={styles.section} testID="signin-news-section">
      <View style={styles.head}>
        <View style={styles.headCopy}>
          <UiText variant="meta" tone="primary" style={styles.eyebrow}>{copy.newsEyebrow}</UiText>
          <UiText accessibilityRole="header" variant="headlineSmall">{copy.newsTitle}</UiText>
        </View>
        <Pressable
          accessibilityLabel={copy.seeAll}
          accessibilityRole="link"
          onPress={() => navigation.navigate('news')}
          style={styles.seeAll}
          testID="signin-news-see-all"
        >
          <UiText numberOfLines={1} variant="label" tone="primary">{copy.seeAll}</UiText>
          <MaterialCommunityIcons accessible={false} color={colors.primary} importantForAccessibility="no" name="chevron-right" size={18} />
        </Pressable>
      </View>
      {list.warning ? (
        <View testID="signin-news-warning">
          <DataNotice message={list.warning} />
        </View>
      ) : null}
      {list.loading ? (
        <View accessibilityLabel={copy.loading} accessibilityLiveRegion="polite" accessible style={styles.feed} testID="signin-news-loading">
          <View style={[styles.skeletonBlock, styles.skeletonCover]} />
          <View style={[styles.skeletonBlock, styles.skeletonRow]} />
          <View style={[styles.skeletonBlock, styles.skeletonRow]} />
          <View style={[styles.skeletonBlock, styles.skeletonRow]} />
        </View>
      ) : list.error ? (
        <View testID="signin-news-error">
          <StatePanel kind="error" title={list.error} actionLabel={copy.retry} onAction={() => void list.reload()} />
        </View>
      ) : !featured ? (
        <View style={styles.empty} testID="signin-news-empty">
          <UiText variant="bodySmall" tone="muted">{copy.empty}</UiText>
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
          {rest.map((item, index) => (
            <CompactNewsRow
              date={item.publishAt ? formatDate(item.publishAt) : ''}
              index={index}
              item={item}
              key={item.id}
              onPress={() => open(item)}
              urgentLabel={isUrgentPriority(item.priority) ? priorityLabels.URGENT : ''}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function NewsCover({ url }: { url?: string | null }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeNewsStyles);
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <View importantForAccessibility="no" style={[styles.cover, styles.coverPlaceholder]} testID="signin-news-cover-placeholder">
        <MaterialCommunityIcons accessible={false} color={colors.textMuted} name="newspaper-variant-outline" size={32} />
      </View>
    );
  }
  return <Image accessible={false} onError={() => setFailed(true)} resizeMode="cover" source={{ uri: url }} style={styles.cover} testID="signin-news-cover" />;
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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeNewsStyles);
  return (
    <Pressable
      accessibilityLabel={joinMeta([item.title, category, date])}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [pressed ? styles.pressed : undefined]}
      testID="signin-news-featured"
    >
      <Card style={styles.featuredCard}>
        <NewsCover key={item.coverImageUrl ?? 'none'} url={item.coverImageUrl} />
        <View style={styles.featuredBody}>
          <View style={styles.metaRow}>
            {category ? <StatusPill label={category} tone="primary" /> : null}
            {date ? <UiText variant="meta" tone="muted">{date}</UiText> : null}
          </View>
          <UiText numberOfLines={2} variant="label">{item.title}</UiText>
          {summary ? <UiText numberOfLines={2} variant="bodySmall" tone="muted">{summary}</UiText> : null}
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
  index,
  date,
  urgentLabel,
  onPress,
}: {
  item: MobilePublicAnnouncement;
  index: number;
  date: string;
  urgentLabel: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeNewsStyles);
  return (
    <Pressable
      accessibilityLabel={joinMeta([item.title, urgentLabel, date])}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.surfaceLow } : undefined]}
      testID={`signin-news-row-${index}`}
    >
      <View style={styles.rowCopy}>
        <UiText numberOfLines={2} variant="label">{item.title}</UiText>
        <View style={styles.metaRow}>
          {urgentLabel ? <StatusPill label={urgentLabel} tone="error" /> : null}
          {date ? <UiText variant="meta" tone="muted">{date}</UiText> : null}
        </View>
      </View>
      <MaterialCommunityIcons accessible={false} color={colors.textMuted} importantForAccessibility="no" name="chevron-right" size={20} />
    </Pressable>
  );
}

const makeNewsStyles = (colors: ThemeColors) => StyleSheet.create({
  section: { gap: tokens.spacing.sm, marginTop: tokens.spacing.lg },
  head: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  headCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  eyebrow: { letterSpacing: 0.6, textTransform: 'uppercase' },
  seeAll: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.xs, minHeight: tokens.layout.touchTarget },
  feed: { gap: tokens.spacing.sm },
  featuredCard: { overflow: 'hidden', padding: 0 },
  cover: { height: 160, width: '100%' },
  coverPlaceholder: { alignItems: 'center', backgroundColor: colors.surfaceLow, justifyContent: 'center' },
  featuredBody: { gap: tokens.spacing.xs, padding: tokens.spacing.md },
  metaRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  readRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.xs, marginTop: tokens.spacing.xs },
  row: { alignItems: 'center', borderRadius: tokens.radii.control, flexDirection: 'row', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.xs },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  empty: { paddingVertical: tokens.spacing.sm },
  skeletonBlock: { backgroundColor: colors.surfaceLow, borderRadius: tokens.radii.control },
  skeletonCover: { height: 200 },
  skeletonRow: { height: tokens.layout.touchTarget },
  pressed: { opacity: 0.88 },
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1 },
  hero: { paddingBottom: HERO_OVERLAP + tokens.spacing.lg, paddingHorizontal: tokens.spacing.lg },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.md },
  brandMark: { backgroundColor: tokens.colors.card, borderRadius: tokens.radii.control, height: 56, width: 56 },
  brandCopy: { flex: 1, minWidth: 0, gap: tokens.spacing.xs },
  heroTitle: { marginTop: tokens.spacing.lg },
  body: { alignSelf: 'center', flex: 1, maxWidth: tokens.windowClasses.contentMaxWidth.medium, paddingHorizontal: tokens.layout.mobileGutter, width: '100%' },
  formCard: { marginTop: -HERO_OVERLAP, padding: tokens.spacing.lg },
  formIntro: { marginBottom: tokens.spacing.md, marginTop: tokens.spacing.xs },
  guestRow: { flexDirection: 'row', gap: tokens.spacing.sm, marginTop: tokens.spacing.md },
  guestColumn: { gap: tokens.spacing.sm, marginTop: tokens.spacing.md },
  guestButton: { flex: 1 },
  footerFlex: { flex: 1, minHeight: tokens.spacing.lg },
  submit: { marginTop: tokens.spacing.sm },
  errorPanel: { backgroundColor: colors.errorFixed, borderColor: colors.error, borderRadius: tokens.radii.control, borderWidth: 1, marginTop: tokens.spacing.md, padding: tokens.spacing.sm },
});
