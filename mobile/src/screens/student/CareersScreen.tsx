import { useCallback, useState } from 'react';
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
  ApiClientError,
  apiClient,
  campusApi,
  type MobileCareerApplication,
  type MobileCareerOpportunity,
} from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { careersMessages, type CareersLocale } from '../../i18n/careers-messages';
import type { MobileScreenProps } from '../../navigation/types';

/**
 * §9 candidate careers surface (P12): browse published postings, apply,
 * own application history and owner withdraw. Recruiter/reviewer lanes
 * and attachment uploads stay on the web surface; every mutation carries
 * Idempotency-Key and application states are server-owned.
 */
const previewOpportunities: MobileCareerOpportunity[] = [
  {
    id: 'preview-opp-1',
    organizationId: 'preview-org',
    organizationName: 'UTE Tech Partners',
    title: 'Thực tập sinh Backend',
    location: 'TP.HCM',
    employmentType: 'INTERNSHIP',
    status: 'PUBLISHED',
    version: 1,
    createdAt: '2026-10-01T00:00:00Z',
  },
];

const previewApplications: MobileCareerApplication[] = [
  {
    id: 'preview-app-1',
    opportunityId: 'preview-opp-1',
    opportunityTitle: 'Thực tập sinh Backend',
    organizationId: 'preview-org',
    organizationName: 'UTE Tech Partners',
    candidateUserId: 'preview-user',
    status: 'REVIEWING',
    submittedAt: '2026-10-02T00:00:00Z',
    version: 2,
    createdAt: '2026-10-02T00:00:00Z',
  },
];

function errorCode(error: unknown): string {
  return error instanceof ApiClientError ? String(error.code ?? '') : '';
}

function isWithdrawable(application: MobileCareerApplication): boolean {
  return ['SUBMITTED', 'REVIEWING', 'INTERVIEW', 'OFFER'].includes(application.status);
}

export function CareersScreen(_props: MobileScreenProps) {
  const [locale, setLocale] = useState<CareersLocale>('vi');
  const copy = careersMessages[locale];
  const statusLabel = (status: string) => copy.statusLabels[status] ?? status;
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
  const [coverLetters, setCoverLetters] = useState<Record<string, string>>({});
  const [mutating, setMutating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const isPreview = apiClient.mode === 'preview';

  const boardQuery = useScreenQuery<MobileCareerOpportunity[]>(
    `careers.board.${search}`,
    () => campusApi.careersOpportunities(search || undefined),
    {
      enabled: apiClient.mode === 'live',
      errorMessage: copy.unavailable,
      mapError: () => copy.unavailable,
    },
  );
  const applicationsQuery = useScreenQuery<MobileCareerApplication[]>(
    'careers.myApplications',
    () => campusApi.careersMyApplications(),
    {
      enabled: apiClient.mode === 'live',
      errorMessage: copy.unavailable,
      mapError: () => copy.unavailable,
    },
  );

  const opportunities = isPreview ? previewOpportunities : boardQuery.data ?? [];
  const applications = isPreview ? previewApplications : applicationsQuery.data ?? [];
  const appliedIds = new Set(
    applications.filter(isWithdrawable).map((application) => application.opportunityId));

  const friendlyError = (error: unknown): string => {
    const code = errorCode(error);
    if (code === 'APPLICATION_ACTIVE') return copy.alreadyApplied;
    if (code === 'OPPORTUNITY_NOT_OPEN') return copy.notOpen;
    return copy.failed;
  };

  const refresh = useCallback(async () => {
    await Promise.all([boardQuery.reload(), applicationsQuery.reload()]);
  }, [boardQuery, applicationsQuery]);

  const run = async (action: () => Promise<unknown>, okMessage: string) => {
    setMutating(true);
    setMutationError(null);
    setNotice(null);
    try {
      await action();
      setNotice(okMessage);
      await refresh();
    } catch (error) {
      setMutationError(friendlyError(error));
    } finally {
      setMutating(false);
    }
  };

  const apply = (opportunity: MobileCareerOpportunity) => {
    void run(
      () => campusApi.careersApply(opportunity.id, coverLetters[opportunity.id] ?? ''),
      copy.applied,
    );
  };

  const withdraw = (application: MobileCareerApplication) => {
    void run(
      () => campusApi.careersWithdraw(application.id, application.version),
      copy.withdrawn,
    );
  };

  return (
    <ScreenShell
      title={copy.title}
      eyebrow={copy.eyebrow}
      subtitle={copy.subtitle}
      headerAction={languageSelector}
    >
      <DataNotice message={copy.simulatedBanner} />
      {notice ? <DataNotice message={notice} /> : null}
      {mutationError ? <StatePanel kind="error" title={copy.errorTitle} description={mutationError} /> : null}

      <SectionHeading title={copy.board} />
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
      {boardQuery.isLoading && !isPreview ? (
        <StatePanel kind="loading" title={copy.loading} />
      ) : null}
      {boardQuery.error != null && !isPreview ? (
        <StatePanel
          kind="error"
          title={copy.errorTitle}
          description={copy.unavailable}
          actionLabel={copy.retry}
          onAction={() => void refresh()}
        />
      ) : null}
      {opportunities.length === 0 && !boardQuery.isLoading ? (
        <Card>
          <UiText variant="label">{copy.emptyBoard}</UiText>
        </Card>
      ) : null}
      {opportunities.map((opportunity) => (
        <Card key={opportunity.id}>
          <UiText variant="label">{opportunity.title}</UiText>
          <UiText variant="bodySmall" tone="muted">
            {[opportunity.organizationName, opportunity.location,
              opportunity.employmentType, opportunity.salaryText]
              .filter(Boolean).join(' · ')}
          </UiText>
          {opportunity.description ? (
            <UiText variant="bodySmall" tone="muted">{opportunity.description}</UiText>
          ) : null}
          {appliedIds.has(opportunity.id) ? null : (
            <>
              <Field
                label={copy.coverLetter}
                placeholder={copy.coverLetterPlaceholder}
                value={coverLetters[opportunity.id] ?? ''}
                onChangeText={(value) => setCoverLetters((current) => ({
                  ...current, [opportunity.id]: value,
                }))}
              />
              <Button
                label={copy.apply}
                variant="secondary"
                loading={mutating}
                disabled={mutating}
                onPress={() => apply(opportunity)}
              />
            </>
          )}
        </Card>
      ))}

      <SectionHeading title={copy.myApplications} />
      {applicationsQuery.isLoading && !isPreview ? (
        <StatePanel kind="loading" title={copy.loading} />
      ) : null}
      {applications.length === 0 && !applicationsQuery.isLoading ? (
        <Card>
          <UiText variant="label">{copy.emptyApplications}</UiText>
        </Card>
      ) : null}
      {applications.map((application) => (
        <ListRow
          key={application.id}
          title={application.opportunityTitle ?? application.opportunityId}
          subtitle={
            `${application.organizationName ?? ''} · ${statusLabel(application.status)}`
              + (application.submittedAt ? ` · ${copy.submittedAt}: ${application.submittedAt}` : '')
              + (application.moderationReason ? ` · ${copy.reason}: ${application.moderationReason}` : '')
          }
          trailing={isWithdrawable(application) ? (
            <Button
              label={copy.withdraw}
              variant="secondary"
              loading={mutating}
              disabled={mutating}
              onPress={() => withdraw(application)}
            />
          ) : undefined}
        />
      ))}

      <UiText variant="bodySmall" tone="muted">{copy.staffLaneNote}</UiText>
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
