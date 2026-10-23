import { useState } from 'react';
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
import {
  apiClient,
  campusApi,
  type MobilePublicDoc,
} from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { campusMessages, type CampusLocale } from '../../i18n/campus-messages';
import type { MobileScreenProps } from '../../navigation/types';

/**
 * §5 public documentation lane (P13): published-document search in both
 * locales — the server serves only the publishedRevision body, so a
 * draft head can never leak to the native surface.
 */
const previewDocs: MobilePublicDoc[] = [
  {
    slug: 'preview-doc-1',
    categoryId: 'regulations',
    publishedRevision: 2,
    titleVi: 'Quy chế đào tạo tín chỉ',
    titleEn: 'Credit training regulations',
    summaryVi: 'Quy định về đăng ký học phần, tính điểm và tốt nghiệp.',
    summaryEn: 'Rules on course registration, grading and graduation.',
    bodyVi: 'Quy chế đào tạo theo học chế tín chỉ quy định khung chương trình, điều kiện đăng ký học phần, thang điểm và tiêu chuẩn tốt nghiệp cho sinh viên.',
    bodyEn: 'The credit-based training regulation covers the programme framework, course registration rules, grading scale and graduation requirements.',
    publishedAt: '2026-10-15T01:00:00Z',
    tagIds: ['regulation', 'academic'],
  },
];

function docTitle(doc: MobilePublicDoc, locale: CampusLocale): string {
  return locale === 'vi' ? doc.titleVi : doc.titleEn;
}

function docSummary(doc: MobilePublicDoc, locale: CampusLocale): string {
  return (locale === 'vi' ? doc.summaryVi : doc.summaryEn) ?? '';
}

function docBody(doc: MobilePublicDoc, locale: CampusLocale): string {
  return (locale === 'vi' ? doc.bodyVi : doc.bodyEn) ?? '';
}

export function DocsScreen(_props: MobileScreenProps) {
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

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MobilePublicDoc | null>(null);
  const [detailLoadingSlug, setDetailLoadingSlug] = useState<string | null>(null);
  const [detailError, setDetailError] = useState(false);
  const isPreview = apiClient.mode === 'preview';

  const docsQuery = useScreenQuery<MobilePublicDoc[]>(
    `campus.docs.${search}`,
    async () => (await campusApi.publicDocs(search || undefined, 1, 30)).data,
    {
      enabled: apiClient.mode === 'live',
      errorMessage: copy.docsUnavailable,
      mapError: () => copy.docsUnavailable,
    },
  );
  const docs = isPreview ? previewDocs : docsQuery.data ?? [];
  const warning = !isPreview ? docsQuery.warning : null;

  const open = async (doc: MobilePublicDoc) => {
    if (isPreview) {
      setSelected(doc);
      return;
    }
    setDetailLoadingSlug(doc.slug);
    setDetailError(false);
    try {
      setSelected(await campusApi.publicDoc(doc.slug));
    } catch {
      setDetailError(true);
      setSelected(null);
    } finally {
      setDetailLoadingSlug(null);
    }
  };

  return (
    <ScreenShell
      title={copy.docsTitle}
      eyebrow={copy.docsEyebrow}
      subtitle={copy.docsSubtitle}
      headerAction={languageSelector}
    >
      {isPreview ? <DataNotice message={copy.simulatedBanner} /> : null}
      {warning ? <DataNotice message={warning} /> : null}

      <SectionHeading title={copy.search} />
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

      {docsQuery.isLoading && !isPreview ? (
        <StatePanel kind="loading" title={copy.docsLoading} />
      ) : null}
      {docsQuery.error != null && !isPreview ? (
        <StatePanel
          kind="error"
          title={copy.errorTitle}
          description={copy.docsUnavailable}
          actionLabel={copy.retry}
          onAction={() => void docsQuery.reload()}
        />
      ) : null}
      {docs.length === 0 && !docsQuery.isLoading && (isPreview || docsQuery.error == null) ? (
        <Card>
          <UiText variant="label">{copy.emptyDocs}</UiText>
        </Card>
      ) : null}
      {docs.map((doc) => (
        <ListRow
          key={doc.slug}
          title={docTitle(doc, locale)}
          subtitle={[
            docSummary(doc, locale),
            doc.categoryId ? `${doc.categoryId}` : '',
          ].filter(Boolean).join(' · ')}
          meta={`${copy.revision} ${doc.publishedRevision}`}
          trailing={(
            <Button
              label={copy.readMore}
              variant="secondary"
              loading={detailLoadingSlug === doc.slug}
              disabled={detailLoadingSlug != null}
              onPress={() => void open(doc)}
            />
          )}
        />
      ))}

      {detailError ? (
        <StatePanel
          kind="error"
          title={copy.errorTitle}
          description={copy.detailError}
        />
      ) : null}
      {selected ? (
        <Card>
          <UiText variant="label">{docTitle(selected, locale)}</UiText>
          <UiText variant="bodySmall" tone="muted">
            {[
              selected.categoryId ?? '',
              (selected.tagIds ?? []).length > 0
                ? `${copy.tags}: ${(selected.tagIds ?? []).join(', ')}`
                : '',
            ].filter(Boolean).join(' · ')}
          </UiText>
          <Divider />
          <UiText variant="bodySmall">{docBody(selected, locale)}</UiText>
          <Divider />
          <Button
            label={copy.collapse}
            variant="secondary"
            onPress={() => setSelected(null)}
          />
        </Card>
      ) : null}

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
