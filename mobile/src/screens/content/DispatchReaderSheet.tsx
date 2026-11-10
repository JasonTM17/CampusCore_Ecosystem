import { useEffect, useState } from 'react';
import {
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';

import type { MobilePublicAnnouncement } from '../../api/client';
import { RichAttachments } from '../../components/content/rich-attachments';
import { RichContent, webUrlFor } from '../../components/content/rich-content';
import { Button, StatusPill } from '../../components/ui/index';
import { Sheet } from '../../components/ui/primitives';
import { UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { recordsMessages } from '../../i18n/records-messages';
import {
  dispatchAudienceBadge,
  dispatchProseDate,
  dispatchPublisherLabel,
  dispatchReference,
  dispatchSalutationTarget,
  dispatchSemesterLabel,
  dispatchSubjectHeading,
} from './announcement-dispatch';
import { extractNoticeAttachments } from './content-rules';
import { StatusChip, useContentCopy } from './content-ui';
import { htmlToPlainText, isHtmlBody } from './rich-text';

export interface DispatchReaderSheetProps {
  item: MobilePublicAnnouncement | null;
  visible: boolean;
  onClose: () => void;
}

/** Official dispatch reader matching the web AdministrativeDispatchSheet fields. */
export function DispatchReaderSheet({ item, visible, onClose }: DispatchReaderSheetProps) {
  const { locale, formatDate, formatDateTime } = useContentCopy();
  const { colors } = useTheme();
  const copy = recordsMessages[locale];
  const sheet = copy.announcementsDispatchSheet;
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    setScrollProgress(0);
  }, [item?.id]);

  if (!item) return null;

  const publishDate = item.publishAt || item.createdAt;
  const dateObj = publishDate ? new Date(publishDate) : new Date();
  const officialDate = formatDate(dateObj);
  const proseDate = dispatchProseDate(locale, dateObj);
  const dateLine = sheet.datePrefix.replace(
    '{date}',
    locale === 'vi' ? proseDate : formatDate(dateObj),
  );
  const docRef = sheet.docRef.replace('{ref}', dispatchReference(item));
  const publisherName = dispatchPublisherLabel(item, sheet.departmentName);
  const audience = dispatchAudienceBadge(item, copy.announcementsAudienceBadges);
  const salutationTarget = dispatchSalutationTarget(item, copy.announcementsDispatchSalutation);
  const subjectHeading = dispatchSubjectHeading(item.title);
  const semesterFormatted = dispatchSemesterLabel(item, locale, copy.announcementsSemesterPrefix);
  const body = item.content ?? item.summary;
  const attachments = extractNoticeAttachments(item.content);

  const clampedProgress = Math.min(100, Math.max(0, scrollProgress));
  const roundedProgress = Math.round(clampedProgress);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const totalScroll = contentSize.height - layoutMeasurement.height;
    if (totalScroll <= 0) {
      setScrollProgress(100);
    } else {
      const progress = Math.min(100, Math.max(0, (contentOffset.y / totalScroll) * 100));
      setScrollProgress(progress);
    }
  };

  const handleShare = async () => {
    try {
      const webUrl = webUrlFor(`/dashboard/announcements?id=${encodeURIComponent(item.id)}`);
      await Share.share({
        title: item.title,
        message: `${item.title}\n${webUrl}`,
        url: webUrl,
      });
    } catch {
      // Dismissed or unsupported share action
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item.title}
      scroll={false}
      closeLabel={copy.announcementsDispatchClose}
      closeAccessibilityLabel={copy.announcementsDispatchCloseA11y}
      accessibilityLabel={item.title}
    >
      <View style={styles.sheetContainer}>
        {/* Reading Progress Indicator (Top Micro-bar) */}
        <View
          testID="reading-progress-bar"
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: roundedProgress }}
          accessibilityLabel={copy.announcementsReadingProgress}
          aria-label={copy.announcementsReadingProgress}
          aria-valuenow={roundedProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          style={[styles.progressTrack, { backgroundColor: colors.outlineVariant }]}
        >
          <View
            testID="reading-progress-fill"
            style={[
              styles.progressFill,
              {
                width: `${clampedProgress}%`,
                backgroundColor: colors.primary,
              },
            ]}
          />
        </View>

        {/* Floating Sticky Reading Toolbar */}
        <View style={styles.toolbarRow} testID="reading-toolbar">
          <Button
            label={copy.announcementsShare}
            icon="share-variant-outline"
            variant="secondary"
            onPress={handleShare}
            accessibilityLabel={copy.announcementsShare}
          />
        </View>

        {/* Scrollable Document Body Container */}
        <ScrollView
          testID="dispatch-reader-scroll"
          style={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          <View style={[styles.sheet, { borderColor: colors.outlineVariant, backgroundColor: colors.card }]}>
            <View style={[styles.headerRow, { borderBottomColor: colors.outlineVariant }]}>
              <View style={styles.issuerColumn}>
                <Image
                  accessibilityRole="image"
                  accessibilityLabel={sheet.universityName}
                  resizeMode="contain"
                  source={require('../../../assets/hcmute-logo.png')}
                  style={[styles.logo, { borderColor: colors.outlineVariant, backgroundColor: colors.surfaceLow }]}
                />
                <View style={styles.issuerCopy}>
                  <UiText adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={2} variant="meta" tone="muted">
                    {sheet.ministryName}
                  </UiText>
                  <UiText adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={2} variant="label" tone="primary">
                    {sheet.universityName}
                  </UiText>
                  <UiText adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={2} variant="label">
                    {publisherName.toUpperCase()}
                  </UiText>
                  <UiText variant="meta" tone="muted">{docRef}</UiText>
                </View>
              </View>
              <View style={styles.mottoColumn}>
                <UiText adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={2} variant="label">{sheet.nationalMotto1}</UiText>
                <UiText adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={1} variant="label">{sheet.nationalMotto2}</UiText>
                <View style={[styles.divider, { borderBottomColor: colors.outline }]} />
                <UiText variant="meta" tone="muted">{dateLine}</UiText>
              </View>
            </View>

            <View style={styles.titleBlock}>
              <UiText accessibilityRole="header" variant="headlineSmall">{sheet.noticeHeader}</UiText>
              <UiText variant="label" tone="primary" style={styles.subject}>{subjectHeading}</UiText>
            </View>

            <View style={[styles.salutationCard, { backgroundColor: colors.surfaceLow, borderColor: colors.outlineVariant }]}>
              <UiText variant="bodyMedium">{`${sheet.salutation}: ${salutationTarget}`}</UiText>
              <View style={styles.metaRow}>
                <UiText variant="meta" tone="muted">{publisherName}</UiText>
                <StatusPill label={audience.label} tone={audience.tone} />
                {semesterFormatted ? <UiText variant="meta">{semesterFormatted}</UiText> : null}
                <StatusChip code={item.priority} labels={copy.priorityLabels} />
                <UiText variant="meta" tone="muted">{officialDate}</UiText>
              </View>
            </View>

            <View style={[styles.bodyBlock, { borderColor: colors.outlineVariant }]}>
              {isHtmlBody(body) ? (
                <RichContent html={body} style={styles.body} />
              ) : (
                <UiText variant="bodyLarge" style={styles.body}>{htmlToPlainText(body)}</UiText>
              )}
              <RichAttachments
                attachments={attachments}
                countLabel={copy.announcementsAttachmentCount.replace('{n}', String(attachments.length))}
                documentLabel={copy.announcementsDigitalDocument}
                heading={copy.announcementsAttachments}
              />
            </View>

            <View style={styles.signOff}>
              <UiText variant="label">{sheet.issuedByLabel}</UiText>
              <UiText variant="label" tone="primary">{publisherName.toUpperCase()}</UiText>
              <UiText variant="meta" tone="muted">
                {sheet.signOffHint} — {formatDateTime(dateObj)}
              </UiText>
            </View>
          </View>
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheetContainer: { flexShrink: 1, gap: tokens.spacing.xs },
  progressTrack: { borderRadius: tokens.radii.control, height: 4, overflow: 'hidden', width: '100%' },
  progressFill: { borderRadius: tokens.radii.control, height: '100%' },
  toolbarRow: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'flex-end' },
  scrollBody: { flexShrink: 1 },
  sheet: { borderRadius: tokens.radii.card, borderWidth: 1, gap: tokens.spacing.md, padding: tokens.spacing.md },
  headerRow: { borderBottomWidth: 1, gap: tokens.spacing.md, paddingBottom: tokens.spacing.md },
  issuerColumn: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm },
  logo: { borderRadius: tokens.radii.control, borderWidth: 1, height: 56, width: 56 },
  issuerCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  mottoColumn: { gap: tokens.spacing.xs },
  divider: { alignSelf: 'flex-start', borderBottomWidth: 1, marginVertical: tokens.spacing.xs, width: 112 },
  titleBlock: { alignItems: 'center', gap: tokens.spacing.sm },
  subject: { minWidth: 0, textAlign: 'center' },
  salutationCard: { borderRadius: tokens.radii.control, borderWidth: 1, gap: tokens.spacing.sm, padding: tokens.spacing.md },
  metaRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  bodyBlock: { borderBottomWidth: 1, borderTopWidth: 1, gap: tokens.spacing.md, paddingVertical: tokens.spacing.md },
  body: { minWidth: 0 },
  signOff: { alignItems: 'flex-end', gap: tokens.spacing.xs },
});
