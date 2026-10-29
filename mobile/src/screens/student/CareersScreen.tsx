import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, DataNotice, UiText } from '../../components/Ui';
import { SearchBar, SegmentedControl } from '../../components/ui/index';
import { StatusPill } from '../../components/ui/index';
import { apiClient } from '../../api/client';
import type { MobileCareerOpportunity } from '../../api/client';
import { tokens } from '../../design/tokens';
import { careersMessages } from '../../i18n/careers-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi, type CareerApplicationView } from '../content/content-api';
import { contentErrorMessage, errorCode } from '../content/content-errors';
import { activeOpportunityIds, joinMeta, isApplicationWithdrawable } from '../content/content-rules';
import { ContentIconChip, ListFrame, StatusChip, useConfirm, useContentCopy, useFlash } from '../content/content-ui';
import { ApplicationDetail, OpportunityDetail } from '../content/CareerDetail';
import { previewCareerApplications, previewOpportunities } from '../content/preview-data';
import { useListQuery } from '../content/use-list-query';
import { usePagedList } from '../content/use-paged-list';

type Tab = 'board' | 'mine';
type Sub = 'active' | 'history';

/** Candidate careers: published postings, apply, own applications, attachments and withdraw. States are server-owned. */
export function CareersScreen(_props: MobileScreenProps) {
  const { locale, formatDate, copy: common } = useContentCopy();
  const copy = careersMessages[locale];
  const [tab, setTab] = useState<Tab>('board');
  const [sub, setSub] = useState<Sub>('active');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [opportunity, setOpportunity] = useState<MobileCareerOpportunity | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { flash, success, fail, clear } = useFlash();
  const { ask, dialog } = useConfirm();
  const live = apiClient.mode === 'live';

  const previewOpps = useMemo(() => previewOpportunities(locale), [locale]);
  const previewApps = useMemo(() => previewCareerApplications(locale), [locale]);
  const board = usePagedList<MobileCareerOpportunity>({
    key: `content.careers.board.${search}`,
    fetchPage: (page, limit, signal) => contentApi.careersOpportunities({ page, limit, signal, query: search || undefined }),
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
    if (busy || !live) return false;
    setBusy(true);
    clear();
    try {
      await action();
      success(ok);
      void apps.reload();
      return true;
    } catch (error) {
      fail(failureFor?.(errorCode(error)) ?? contentErrorMessage(common, error, copy.failed));
      return false;
    } finally {
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

  const tabs = (
    <SegmentedControl
      accessibilityLabel={copy.title}
      value={tab}
      onChange={(value) => setTab(value as Tab)}
      options={[{ value: 'board', label: copy.board }, { value: 'mine', label: copy.myApplications }]}
    />
  );
  const banner = <DataNotice message={copy.simulatedBanner} />;
  const mine = apps.items.filter((item) => (sub === 'active') === isApplicationWithdrawable(item));

  return (
    <>
      {tab === 'board' ? (
        <ListFrame
          title={copy.title}
          icon="briefcase-outline"
          list={board}
          filtered={search.length > 0}
          keyOf={(item) => item.id}
          emptyTitle={copy.emptyBoard}
          flash={flash}
          header={(
            <View style={styles.header}>
              {banner}
              {tabs}
              <SearchBar
                value={input}
                onChangeText={setInput}
                onClear={() => { setInput(''); setSearch(''); }}
                placeholder={copy.searchPlaceholder}
                accessibilityLabel={copy.search}
                returnKeyType="search"
                onSubmitEditing={() => setSearch(input.trim())}
              />
            </View>
          )}
          renderItem={(item) => (
            <Card>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={joinMeta([item.title, item.organizationName, item.location])}
                onPress={() => setOpportunity(item)}
                style={styles.rowMain}
              >
                <ContentIconChip icon="briefcase-outline" />
                <View style={styles.rowCopy}>
                  <UiText variant="label">{item.title}</UiText>
                  <UiText variant="bodySmall" tone="muted">{joinMeta([item.organizationName, item.location, item.employmentType])}</UiText>
                  <View style={styles.chips}>
                    {liveIds.has(item.id) ? <StatusPill label={copy.alreadyApplied} tone="success" /> : null}
                  </View>
                </View>
              </Pressable>
            </Card>
          )}
        />
      ) : (
        <ListFrame
          title={copy.title}
          icon="briefcase-check-outline"
          list={apps}
          items={mine}
          filtered
          keyOf={(item) => item.id}
          emptyTitle={sub === 'active' ? copy.emptyApplications : copy.emptyHistory}
          flash={flash}
          header={(
            <View style={styles.header}>
              {banner}
              {tabs}
              <SegmentedControl
                accessibilityLabel={copy.myApplications}
                value={sub}
                onChange={(value) => setSub(value as Sub)}
                options={[{ value: 'active', label: copy.applicationsActive }, { value: 'history', label: copy.applicationsHistory }]}
              />
            </View>
          )}
          renderItem={(item) => (
            <Card>
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
                    {joinMeta([item.organizationName, item.submittedAt ? `${copy.submittedAt}: ${formatDate(item.submittedAt)}` : null])}
                  </UiText>
                  <View style={styles.chips}>
                    <StatusChip code={item.status} labels={copy.statusLabels} />
                  </View>
                </View>
              </Pressable>
            </Card>
          )}
        />
      )}
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.spacing.sm },
  rowMain: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  chips: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
});
