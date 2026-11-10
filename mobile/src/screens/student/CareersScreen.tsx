import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, DataNotice, StatePanel, UiText } from '../../components/Ui';
import { Button, SearchBar } from '../../components/ui/index';
import { StatusPill } from '../../components/ui/index';
import { apiClient } from '../../api/client';
import type { MobileCareerOpportunity } from '../../api/client';
import { tokens } from '../../design/tokens';
import { careersMessages } from '../../i18n/careers-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi, type CareerApplicationView } from '../content/content-api';
import { contentErrorMessage, errorCode } from '../content/content-errors';
import { CONTENT_PAGE_SIZE } from '../content/content-paging';
import type { StatusTone } from '../../components/ui/institutional';
import { activeOpportunityIds, careerOpportunityTone, employmentTypeLabel, joinMeta } from '../content/content-rules';
import { ContentIconChip, ListFrame, useConfirm, useContentCopy, useFlash } from '../content/content-ui';
import { ApplicationDetail, OpportunityDetail } from '../content/CareerDetail';
import { previewCareerApplications, previewOpportunities } from '../content/preview-data';
import { useListQuery } from '../content/use-list-query';
import { usePagedList } from '../content/use-paged-list';

/** Mirrors `frontend/src/components/careers/CareersBoardPage.tsx` application status tones. */
function careersApplicationTone(status: string): StatusTone {
  switch (status) {
    case 'SUBMITTED': return 'warning';
    case 'REVIEWING':
    case 'INTERVIEW': return 'info';
    case 'OFFER': return 'success';
    case 'REJECTED': return 'error';
    case 'WITHDRAWN': return 'neutral';
    default: return 'neutral';
  }
}

/** Candidate careers: published postings, apply, own applications, attachments and withdraw. States are server-owned. */
export function CareersScreen(_props: MobileScreenProps) {
  const { locale, formatDateTime, copy: common } = useContentCopy();
  const copy = careersMessages[locale];
  const [page, setPage] = useState(0);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [opportunity, setOpportunity] = useState<MobileCareerOpportunity | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const { flash, success, fail, clear } = useFlash();
  const { ask, dialog } = useConfirm();
  const live = apiClient.mode === 'live';

  const previewOpps = useMemo(() => previewOpportunities(locale), [locale]);
  const previewApps = useMemo(() => previewCareerApplications(locale), [locale]);
  const board = usePagedList<MobileCareerOpportunity>({
    key: `content.careers.board.${search}.${page}`,
    fetchPage: (requestedPage, limit, signal) => contentApi.careersOpportunities({ page: page + requestedPage, limit, signal, query: search || undefined }),
    keyOf: (item) => item.id,
    preview: previewOpps,
  });
  const apps = useListQuery<CareerApplicationView>({
    key: 'content.careers.applications',
    fetchAll: () => contentApi.careersApplications(),
    preview: previewApps,
  });
  const liveIds = useMemo(() => activeOpportunityIds(apps.items), [apps.items]);

  const run = useCallback(async (action: () => Promise<unknown>, ok: string, failureFor?: (code: string | undefined) => string | null) => {
    if (busyRef.current || busy || !live) return false;
    busyRef.current = true;
    setBusy(true);
    clear();
    try {
      await action();
      success(ok);
      // The application row keeps its pre-write status until the read lands;
      // hold the lock across it so a second tap cannot repeat the write.
      await apps.reload();
      return true;
    } catch (error) {
      fail(failureFor?.(errorCode(error)) ?? contentErrorMessage(common, error, copy.failed));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [apps, busy, clear, common, copy.failed, fail, live, success]);

  const apply = (target: MobileCareerOpportunity, coverLetter: string) => ask({
    title: copy.applyTitle,
    description: target.title,
    confirmLabel: copy.apply,
    cancelLabel: common.back,
    onConfirm: () => void run(
      () => contentApi.careersApply(target.id, coverLetter),
      copy.applied,
      (code) => (code === 'APPLICATION_ACTIVE' ? copy.alreadyApplied : code === 'OPPORTUNITY_NOT_OPEN' ? copy.notOpen : null),
    ),
  });

  const withdraw = (target: CareerApplicationView) => ask({
    title: copy.withdrawTitle,
    description: target.opportunityTitle ?? undefined,
    confirmLabel: copy.withdraw,
    cancelLabel: copy.keep,
    destructive: true,
    onConfirm: () => void run(() => contentApi.careersWithdraw(target.id, target.version), copy.withdrawn),
  });

  const selectedApplication = applicationId ? apps.items.find((item) => item.id === applicationId) ?? null : null;

  if (opportunity) {
    return (
      <>
        <OpportunityDetail
          opportunity={opportunity}
          alreadyApplied={liveIds.has(opportunity.id)}
          busy={busy}
          preview={!live}
          flash={flash}
          onBack={() => { setOpportunity(null); clear(); }}
          onApply={(letter) => apply(opportunity, letter)}
        />
        {dialog}
      </>
    );
  }
  if (selectedApplication) {
    return (
      <>
        <ApplicationDetail
          application={selectedApplication}
          busy={busy}
          preview={!live}
          flash={flash}
          onBack={() => { setApplicationId(null); clear(); }}
          onWithdraw={withdraw}
          onUploaded={() => { success(common.uploaded); void apps.reload(); }}
        />
        {dialog}
      </>
    );
  }

  // The simulated-environment notice is part of the board itself, in live mode too.
  const banner = <DataNotice message={copy.simulatedBanner} />;
  const applicationsSection = (
    <View style={styles.applicationsSection}>
      <UiText accessibilityRole="header" variant="headlineSmall">{copy.myApplications}</UiText>
      {apps.error ? (
        <StatePanel kind="error" title={copy.errorTitle} description={apps.error} actionLabel={copy.retry} onAction={() => void apps.reload()} />
      ) : null}
      {apps.loading && apps.items.length === 0 ? <StatePanel kind="loading" title={copy.loading} /> : null}
      {!apps.loading && !apps.error && apps.items.length === 0 ? <StatePanel kind="empty" title={copy.emptyApplications} /> : null}
      {apps.items.map((item) => (
        <Card key={item.id}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={joinMeta([item.opportunityTitle, copy.statusLabels[item.status] ?? item.status, item.organizationName])}
            onPress={() => setApplicationId(item.id)}
            style={styles.rowMain}
          >
            <ContentIconChip icon="briefcase-check-outline" />
            <View style={styles.rowCopy}>
              <UiText variant="label">{item.opportunityTitle ?? item.opportunityId}</UiText>
              <UiText variant="bodySmall" tone="muted">
                {joinMeta([item.organizationName, item.submittedAt ? `${copy.submittedAt}: ${formatDateTime(item.submittedAt)}` : null])}
              </UiText>
              {item.moderationReason ? <UiText variant="bodySmall" tone="error">{copy.reason}: {item.moderationReason}</UiText> : null}
              <View style={styles.chips}>
                <StatusPill label={copy.statusLabels[item.status] ?? item.status} tone={careersApplicationTone(item.status)} />
              </View>
            </View>
          </Pressable>
        </Card>
      ))}
    </View>
  );
  const boardList = board.total === undefined ? board : { ...board, total: undefined, hasMore: false };
  const totalPages = board.total === undefined ? null : Math.max(1, Math.ceil(board.total / CONTENT_PAGE_SIZE));
  const firstVisible = board.items.length === 0 ? 0 : page * CONTENT_PAGE_SIZE + 1;
  const lastVisible = page * CONTENT_PAGE_SIZE + board.items.length;
  const paginationSummary = board.total === undefined
    ? null
    : `${common.showingResults} ${firstVisible} ${common.to} ${lastVisible} ${common.of} ${board.total} ${common.results}`;
  const paginationSection = paginationSummary ? (
    <View style={styles.pagination}>
      <UiText accessibilityLiveRegion="polite" variant="bodySmall" tone="muted" style={styles.paginationSummary}>{paginationSummary}</UiText>
      {totalPages !== null && (page > 0 || page + 1 < totalPages) ? (
        <View style={styles.paginationActions}>
          <Button label={common.goToPreviousPage} variant="secondary" disabled={page === 0} onPress={() => setPage((current) => Math.max(0, current - 1))} />
          <Button label={common.goToNextPage} variant="secondary" disabled={page + 1 >= totalPages} onPress={() => setPage((current) => Math.min(totalPages - 1, current + 1))} />
        </View>
      ) : null}
    </View>
  ) : null;
  const footer = (
    <View style={styles.listFooter}>
      {paginationSection}
      {applicationsSection}
    </View>
  );

  return (
    <>
      <ListFrame
        title={copy.title}
        eyebrow={copy.eyebrow}
        description={copy.description}
        icon="briefcase-outline"
        list={boardList}
        filtered={search.length > 0}
        keyOf={(item) => item.id}
        emptyTitle={copy.emptyBoard}
        flash={flash}
        footer={footer}
        header={(
          <View style={styles.header}>
            {banner}
            <View style={styles.searchRow}>
              <SearchBar
                value={input}
                onChangeText={setInput}
                onClear={() => { setInput(''); setSearch(''); setPage(0); }}
                placeholder={copy.searchPlaceholder}
                accessibilityLabel={copy.search}
                returnKeyType="search"
                onSubmitEditing={() => { setPage(0); setSearch(input.trim()); }}
                style={styles.searchField}
              />
              <Button label={copy.search} variant="secondary" onPress={() => { setPage(0); setSearch(input.trim()); }} />
            </View>
          </View>
        )}
        renderItem={(item) => (
          <Card>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={joinMeta([
                item.title,
                item.organizationName,
                item.location,
                employmentTypeLabel(copy.employmentTypeLabels, item.employmentType),
                item.salaryText,
                copy.opportunityStatusLabels[item.status] ?? item.status,
                liveIds.has(item.id) ? copy.appliedBadge : null,
              ])}
              onPress={() => setOpportunity(item)}
              style={styles.rowMain}
            >
              <ContentIconChip icon="briefcase-outline" />
              <View style={styles.rowCopy}>
                <UiText variant="label">{item.title}</UiText>
                <UiText variant="bodySmall" tone="muted">{joinMeta([item.organizationName, item.location, employmentTypeLabel(copy.employmentTypeLabels, item.employmentType), item.salaryText])}</UiText>
                {item.description ? <UiText variant="bodySmall" tone="muted" style={styles.oppDescription}>{item.description}</UiText> : null}
                <View style={styles.chips}>
                  <StatusPill label={copy.opportunityStatusLabels[item.status] ?? item.status} tone={careerOpportunityTone(item.status)} />
                  {liveIds.has(item.id) ? <StatusPill label={copy.appliedBadge} tone="success" /> : null}
                </View>
              </View>
            </Pressable>
          </Card>
        )}
      />
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.spacing.sm },
  searchRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  searchField: { flex: 1, minWidth: 160 },
  oppDescription: { minWidth: 0 },
  applicationsSection: { gap: tokens.spacing.sm, paddingTop: tokens.spacing.md },
  listFooter: { gap: tokens.spacing.md },
  pagination: { alignItems: 'center', borderTopColor: tokens.colors.outlineVariant, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between', paddingTop: tokens.spacing.md },
  paginationActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'flex-end' },
  paginationSummary: { flexShrink: 1, minWidth: 0 },
  rowMain: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  chips: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
});
