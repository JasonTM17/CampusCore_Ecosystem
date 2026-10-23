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
  type MobileAdmissionApplication,
} from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { admissionsMessages, type AdmissionsLocale } from '../../i18n/admissions-messages';
import type { MobileScreenProps } from '../../navigation/types';

/**
 * §7 applicant admissions surface (P10): per-cycle draft, field save,
 * submit/resubmit and withdraw with optimistic version + retry keys.
 * Attachments and the staff queue stay web lanes; the SIMULATED banner is
 * always visible and an ACCEPTED decision never creates a Student record.
 */
const previewApplications: MobileAdmissionApplication[] = [
  {
    id: 'preview-app-1',
    applicantUserId: 'preview-user',
    cycle: '2026-Q1-DEMO',
    status: 'RETURNED',
    fullName: 'Nguyen Van A',
    schoolName: 'THPT Demo',
    intendedMajor: 'CNTT',
    version: 5,
    createdAt: '2026-10-01T00:00:00Z',
    reviews: [
      { id: 'rev-1', action: 'CLAIM', createdAt: '2026-10-02T00:00:00Z' },
      { id: 'rev-2', action: 'RETURN', note: 'Bo sung bang diem', createdAt: '2026-10-03T00:00:00Z' },
    ],
  },
];

function errorCode(error: unknown): string {
  return error instanceof ApiClientError ? String(error.code ?? '') : '';
}

export function AdmissionsScreen(_props: MobileScreenProps) {
  const [locale, setLocale] = useState<AdmissionsLocale>('vi');
  const copy = admissionsMessages[locale];
  const statusLabel = (status: string) => copy.statusLabels[status] ?? status;
  const actionLabel = (action: string) => copy.reviewActions[action] ?? action;
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cycle, setCycle] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [intendedMajor, setIntendedMajor] = useState('');
  const [essay, setEssay] = useState('');
  const [mutating, setMutating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const isPreview = apiClient.mode === 'preview';

  const applicationsQuery = useScreenQuery<MobileAdmissionApplication[]>(
    'admissions.my',
    () => campusApi.admissionsMy(),
    {
      enabled: apiClient.mode === 'live',
      errorMessage: copy.unavailable,
      mapError: () => copy.unavailable,
    },
  );

  const applications = isPreview ? previewApplications : applicationsQuery.data ?? [];
  const selected = applications.find((application) => application.id === selectedId)
    ?? applications[0]
    ?? null;
  const editable = selected != null && (selected.status === 'DRAFT' || selected.status === 'RETURNED');
  const terminal = selected != null
    && (selected.status === 'ACCEPTED' || selected.status === 'REJECTED' || selected.status === 'WITHDRAWN');

  const friendlyError = (error: unknown): string => {
    const code = errorCode(error);
    if (code === 'APPLICATION_CYCLE_ACTIVE') return copy.cycleActive;
    if (code === 'APPLICATION_INCOMPLETE') return copy.incomplete;
    if (code === 'STALE_VERSION') return copy.stale;
    return copy.failed;
  };

  const hydrate = (application: MobileAdmissionApplication | null) => {
    setFullName(application?.fullName ?? '');
    setDateOfBirth(application?.dateOfBirth ?? '');
    setSchoolName(application?.schoolName ?? '');
    setIntendedMajor(application?.intendedMajor ?? '');
    setEssay(application?.essay ?? '');
  };

  const select = (application: MobileAdmissionApplication) => {
    setSelectedId(application.id);
    hydrate(application);
  };

  const refresh = useCallback(async () => {
    await applicationsQuery.reload();
  }, [applicationsQuery]);

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

  const createDraft = () => {
    if (!cycle.trim()) {
      setMutationError(copy.failed);
      return;
    }
    void run(async () => {
      const created = await campusApi.admissionsCreate(cycle.trim());
      setCycle('');
      setSelectedId(created.id);
      hydrate(created);
    }, copy.created);
  };

  const save = () => {
    if (!selected) {
      return;
    }
    void run(() => campusApi.admissionsSave(selected.id, {
      fullName,
      dateOfBirth,
      schoolName,
      intendedMajor,
      essay,
    }, selected.version), copy.saved);
  };

  const submit = () => {
    if (!selected) {
      return;
    }
    void run(() => campusApi.admissionsSubmit(selected.id, selected.version), copy.submitted);
  };

  const withdraw = () => {
    if (!selected) {
      return;
    }
    void run(() => campusApi.admissionsWithdraw(selected.id, selected.version), copy.withdrawn);
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
      {applicationsQuery.error != null && !isPreview ? (
        <StatePanel
          kind="error"
          title={copy.errorTitle}
          description={copy.unavailable}
          actionLabel={copy.retry}
          onAction={() => void refresh()}
        />
      ) : null}

      <SectionHeading title={copy.myApplications} />
      {applicationsQuery.isLoading && !isPreview ? (
        <StatePanel kind="loading" title={copy.loading} />
      ) : null}
      {applications.length === 0 && !applicationsQuery.isLoading ? (
        <Card>
          <UiText variant="label">{copy.emptyApplications}</UiText>
          <UiText variant="bodySmall" tone="muted">{copy.emptyApplicationsDescription}</UiText>
        </Card>
      ) : null}
      {applications.map((application) => (
        <ListRow
          key={application.id}
          title={application.fullName || application.cycle}
          subtitle={`${copy.cycle}: ${application.cycle}`}
          meta={statusLabel(application.status)}
          onPress={() => select(application)}
        />
      ))}

      <SectionHeading title={copy.newApplication} />
      <Card>
        <Field
          label={copy.cycle}
          placeholder={copy.cyclePlaceholder}
          value={cycle}
          onChangeText={setCycle}
        />
        <View style={styles.actionRow}>
          <Button
            label={copy.createDraft}
            loading={mutating}
            disabled={mutating || !cycle.trim()}
            onPress={createDraft}
          />
        </View>
      </Card>

      {selected ? (
        <>
          <SectionHeading title={copy.form} />
          <Card>
            <UiText variant="meta" tone="muted">
              {editable ? (selected.status === 'RETURNED' ? copy.returnedHint : copy.editable)
                : terminal ? copy.terminal : copy.locked}
            </UiText>
            <UiText variant="label">{`${copy.cycle}: ${selected.cycle} · v${selected.version}`}</UiText>
            {selected.decision ? (
              <UiText variant="label" tone="primary">
                {`${copy.decision}: ${statusLabel(selected.decision)} (${selected.decisionLabel ?? 'SIMULATED'})`}
              </UiText>
            ) : null}
            <Divider />
            <Field
              label={copy.fullName}
              placeholder={copy.fullNamePlaceholder}
              value={fullName}
              onChangeText={setFullName}
              editable={editable}
            />
            <Field
              label={copy.dateOfBirth}
              placeholder={copy.dateOfBirthPlaceholder}
              value={dateOfBirth}
              onChangeText={setDateOfBirth}
              editable={editable}
            />
            <Field
              label={copy.schoolName}
              placeholder={copy.schoolNamePlaceholder}
              value={schoolName}
              onChangeText={setSchoolName}
              editable={editable}
            />
            <Field
              label={copy.intendedMajor}
              placeholder={copy.intendedMajorPlaceholder}
              value={intendedMajor}
              onChangeText={setIntendedMajor}
              editable={editable}
            />
            <Field
              label={copy.essay}
              placeholder={copy.essayPlaceholder}
              value={essay}
              onChangeText={setEssay}
              editable={editable}
              multiline
              numberOfLines={4}
            />
            {editable ? (
              <View style={styles.actionRow}>
                <Button label={copy.save} variant="secondary" loading={mutating} disabled={mutating} onPress={save} />
                <Button
                  label={selected.status === 'RETURNED' ? copy.resubmit : copy.submit}
                  loading={mutating}
                  disabled={mutating}
                  onPress={submit}
                />
              </View>
            ) : null}
            {!terminal ? (
              <Button label={copy.withdraw} variant="secondary" loading={mutating} disabled={mutating} onPress={withdraw} />
            ) : null}
            <UiText variant="bodySmall" tone="muted">{copy.attachmentsNote}</UiText>
          </Card>

          <SectionHeading title={copy.reviews} />
          {selected.reviews.length === 0 ? (
            <Card>
              <UiText variant="bodySmall" tone="muted">{copy.emptyReviews}</UiText>
            </Card>
          ) : (
            <Card>
              {selected.reviews.map((review) => (
                <View key={review.id} style={styles.reviewRow}>
                  <UiText variant="label">{actionLabel(review.action)}</UiText>
                  {review.note ? (
                    <UiText variant="bodySmall" tone="muted">{review.note}</UiText>
                  ) : null}
                  {review.decision ? (
                    <UiText variant="label" tone="primary">{statusLabel(review.decision)}</UiText>
                  ) : null}
                  <UiText variant="meta" tone="muted">{review.createdAt}</UiText>
                </View>
              ))}
            </Card>
          )}
        </>
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
  reviewRow: {
    gap: 2,
    paddingVertical: 6,
  },
});
