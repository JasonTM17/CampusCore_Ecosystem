import { useState } from 'react';
import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  DataNotice,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { apiClient, campusApi, ApiClientError, type MobileEnrollment, type RegistrationCatalogSection } from '../../api/client';
import type { MobileScreenProps } from '../../navigation/types';
import { useLiveResource } from './shared/useLiveResource';
import { studentFriendlyErrorMessage } from './shared/errors';
import { useStudentStyles } from './shared/styles';

export function RegistrationScreen({ navigation }: MobileScreenProps) {
  const styles = useStudentStyles();
  const [pending, setPending] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const {
    data: registrationData,
    error,
    warning,
    isLoading,
    reload,
    setData: setRegistrationData,
  } = useLiveResource<{
    sections: RegistrationCatalogSection[];
    enrollments: MobileEnrollment[];
    roundOpen: boolean;
  }>(
    'registration',
    { sections: [], enrollments: [], roundOpen: true },
    async () => {
      const enrollmentResponse = await campusApi.enrollments();
      try {
        const [rounds, catalog] = await Promise.all([
          campusApi.registrationRounds(),
          campusApi.registrationSections(),
        ]);
        return {
          sections: catalog,
          enrollments: enrollmentResponse,
          roundOpen: rounds.some((round) => round.status === 'OPEN'),
        };
      } catch (catalogError) {
        if (
          catalogError instanceof ApiClientError
          && (catalogError.code === 'WINDOW_CLOSED' || catalogError.code === 'COHORT_INELIGIBLE' || catalogError.code === 'ROUND_NOT_FOUND')
        ) {
          return { sections: [], enrollments: enrollmentResponse, roundOpen: false };
        }
        throw catalogError;
      }
    },
    'Registration data is unavailable.',
  );
  const liveSections = registrationData.sections;
  const enrollments = registrationData.enrollments;
  const roundOpen = registrationData.roundOpen;
  const activeEnrollmentCount = enrollments.filter((item) => item.status !== 'DROPPED').length;

  const availableSections = apiClient.mode === 'preview'
    ? [
        { id: 'preview-cs401', code: 'CS401', name: 'Distributed Systems', slot: 'Tue · 10:00 · A3.201', seats: '12 seats left' },
        { id: 'preview-ux305', code: 'UX305', name: 'Service Design', slot: 'Thu · 13:30 · C2.105', seats: '5 seats left' },
        { id: 'preview-ma210', code: 'MA210', name: 'Applied Statistics', slot: 'Fri · 08:00 · B1.101', seats: '8 seats left',
        },
      ]
    : liveSections.map((section) => ({
        id: section.id,
        code: section.courseCode,
        name: section.courseName,
        slot: 'Schedule pending',
        seats: section.remainingSeats > 0 ? `${section.remainingSeats} seats left` : 'Full',
      }));

  const toggleEnrollment = async (sectionId: string) => {
    if (apiClient.mode === 'preview') return;
    setPending(sectionId);
    setMutationError(null);
    try {
      const existing = enrollments.find((item) => item.sectionId === sectionId && item.status !== 'DROPPED');
      if (existing) {
        await campusApi.dropEnrollment(existing.id);
        setRegistrationData((current) => ({
          ...current,
          enrollments: current.enrollments.filter((item) => item.id !== existing.id),
        }));
      } else {
        const next = await campusApi.enroll(sectionId);
        setRegistrationData((current) => ({
          ...current,
          enrollments: [...current.enrollments, next],
        }));
      }
    } catch (nextError) {
      setMutationError(studentFriendlyErrorMessage(nextError, 'Enrollment could not be updated.'));
    } finally {
      setPending(null);
    }
  };

  if (isLoading || error) {
    return (
      <ScreenShell title="Registration" eyebrow="Course planning" subtitle="Review sections in the current registration round.">
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? 'Loading registration…' : 'Registration unavailable'}
          description={error ?? 'Retrieving sections and current enrollments.'}
          actionLabel={error ? 'Try again' : undefined}
          onAction={error ? () => void reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Registration" eyebrow="Course planning" subtitle="Compare available sections and review your current choices.">
      {warning ? <DataNotice message={warning} /> : null}
      <Card tone="primary" style={styles.registrationHero}>
        <UiText variant="meta" tone="primary">COURSE REGISTRATION</UiText>
        <View style={styles.registrationHeroHeader}>
          <View style={styles.registrationHeroCopy}>
            <UiText variant="headlineSmall">Current selections</UiText>
            <UiText variant="bodySmall" tone="muted">
              {apiClient.mode === 'preview'
                ? 'Preview data stays on this device.'
                : `${activeEnrollmentCount} active section${activeEnrollmentCount === 1 ? '' : 's'} selected.`}
            </UiText>
          </View>
          <Badge
            label={apiClient.mode === 'preview' ? 'Preview' : `${activeEnrollmentCount} selected`}
            tone={activeEnrollmentCount > 0 ? 'success' : 'primary'}
          />
        </View>
        <Button label="View selected courses" onPress={() => navigation.navigate('courses')} variant="secondary" />
      </Card>
      <ScreenSpacer />
      <SectionHeading title="Recommended sections" />
      {mutationError ? (
        <StatePanel kind="error" title="Could not update registration" description={mutationError} />
      ) : null}
      {availableSections.map((section) => {
        const enrolled = enrollments.some((item) => item.sectionId === section.id && item.status !== 'DROPPED');
        const isPreview = apiClient.mode === 'preview';
        return (
        <Card key={section.id} style={styles.registrationCard}>
          <UiText variant="meta" tone="primary">{section.code}</UiText>
          <UiText variant="headlineSmall" style={styles.registrationCourseTitle}>
            {section.name}
          </UiText>
          <View style={styles.registrationMeta}>
            <UiText variant="bodySmall" tone="muted" style={styles.registrationSlot}>
              {section.slot}
            </UiText>
            <Badge
              label={section.seats}
              tone={section.seats === 'Full' ? 'warning' : 'success'}
            />
          </View>
          <Button
            label={isPreview ? 'Preview only' : enrolled ? 'Drop section' : 'Add section'}
            disabled={isPreview || !roundOpen || pending === section.id || section.seats === 'Full'}
            loading={pending === section.id}
            onPress={() => void toggleEnrollment(section.id)}
            variant="secondary"
          />
        </Card>
        );
      })}
      {!roundOpen ? (
        <StatePanel kind="empty" title="No registration round is open" description="Course registration is unavailable until an academic round opens." />
      ) : availableSections.length === 0 ? (
        <StatePanel kind="empty" title="No sections available" description="New sections will appear when the academic office publishes them." />
      ) : null}
    </ScreenShell>
  );
}
