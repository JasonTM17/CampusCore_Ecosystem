import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  DataNotice,
  Divider,
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
  type MobileEvent,
  type MobileEventRegistration,
} from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import type { MobileScreenProps } from '../../navigation/types';

/**
 * D4 student events surface (P08): published catalog + self register/cancel
 * + registration history. The server owns every transition; mutations carry
 * client Idempotency-Key headers (created inside campusApi) and the visible
 * state always comes from the refreshed read, never from optimistic writes.
 */
const previewEvents: MobileEvent[] = [
  {
    id: 'preview-event-1',
    title: 'Union birthday volunteer fair',
    organizer: 'Đoàn Thanh niên',
    location: 'Hall A — main campus',
    status: 'REGISTRATION_OPEN',
    capacity: 120,
    registeredCount: 84,
    seatsRemaining: 36,
    startsAt: '2026-11-05T07:30:00Z',
    endsAt: '2026-11-05T10:30:00Z',
    myRegistrationId: null,
    myRegistrationStatus: null,
    myAttendanceStatus: null,
  },
  {
    id: 'preview-event-2',
    title: 'Soft-skills workshop: communication',
    organizer: 'Hội Sinh viên',
    location: 'Room B2.04',
    status: 'PUBLISHED',
    capacity: 40,
    registeredCount: 0,
    seatsRemaining: 40,
    startsAt: '2026-11-21T08:00:00Z',
    endsAt: '2026-11-21T10:00:00Z',
    myRegistrationId: null,
    myRegistrationStatus: null,
    myAttendanceStatus: null,
  },
];

const previewRegistrations: MobileEventRegistration[] = [];

function eventSubtitle(event: MobileEvent): string {
  const when = new Date(event.startsAt);
  const whenText = Number.isNaN(when.getTime())
    ? event.startsAt
    : when.toLocaleString();
  return [event.organizer, event.location, whenText].filter(Boolean).join(' · ');
}

function statusLabel(status: MobileEvent['status']): string {
  switch (status) {
    case 'REGISTRATION_OPEN':
      return 'Open';
    case 'REGISTRATION_CLOSED':
      return 'Closed';
    case 'PUBLISHED':
      return 'Published';
    case 'COMPLETED':
      return 'Completed';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status;
  }
}

export function EventsScreen(_props: MobileScreenProps) {
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const eventsQuery = useScreenQuery<MobileEvent[]>(
    'events',
    () => campusApi.events(),
    {
      enabled: apiClient.mode === 'live',
      errorMessage: 'Events are unavailable.',
      mapError: () => 'Events are unavailable.',
    },
  );
  const registrationsQuery = useScreenQuery<MobileEventRegistration[]>(
    'events.mine',
    () => campusApi.myEventRegistrations(),
    {
      enabled: apiClient.mode === 'live',
      errorMessage: 'Your registrations are unavailable.',
      mapError: () => 'Your registrations are unavailable.',
    },
  );

  const isPreview = apiClient.mode === 'preview';
  const events = isPreview ? previewEvents : eventsQuery.data ?? [];
  const registrations = isPreview
    ? previewRegistrations
    : registrationsQuery.data ?? [];

  const reloadAll = useCallback(() => {
    void eventsQuery.reload();
    void registrationsQuery.reload();
  }, [eventsQuery, registrationsQuery]);

  const register = useCallback(
    async (eventId: string) => {
      if (isPreview || mutating) {
        return;
      }
      setMutating(true);
      setMutationError(null);
      try {
        await campusApi.registerEvent(eventId);
        reloadAll();
      } catch (error) {
        setMutationError(
          error instanceof ApiClientError && error.code === 'EVENT_FULL'
            ? 'This event is full.'
            : 'Registration failed — please try again.',
        );
      } finally {
        setMutating(false);
      }
    },
    [isPreview, mutating, reloadAll],
  );

  const cancel = useCallback(
    async (registrationId: string) => {
      if (isPreview || mutating) {
        return;
      }
      setMutating(true);
      setMutationError(null);
      try {
        await campusApi.cancelEventRegistration(registrationId);
        reloadAll();
      } catch {
        setMutationError('Cancellation failed — please try again.');
      } finally {
        setMutating(false);
      }
    },
    [isPreview, mutating, reloadAll],
  );

  const isLoading =
    !isPreview && (eventsQuery.isLoading || registrationsQuery.isLoading);
  const error = !isPreview
    ? eventsQuery.error ?? registrationsQuery.error
    : null;
  const warning = !isPreview
    ? eventsQuery.warning ?? registrationsQuery.warning
    : null;

  if (isLoading || error) {
    return (
      <ScreenShell
        title="Events"
        eyebrow="Union & association"
        subtitle="Đoàn–Hội activities you can join."
      >
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? 'Loading events…' : 'Events unavailable'}
          description={error ?? 'Retrieving the event catalog.'}
          actionLabel={error ? 'Try again' : undefined}
          onAction={error ? reloadAll : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      title="Events"
      eyebrow="Union & association"
      subtitle="Đoàn–Hội activities you can join."
    >
      {warning ? <DataNotice message={warning} /> : null}
      {mutationError ? (
        <StatePanel kind="error" title={mutationError} />
      ) : null}

      <SectionHeading title="Published events" />
      {events.length === 0 ? (
        <StatePanel
          kind="empty"
          title="No events yet"
          description="Published Đoàn–Hội events will appear here."
        />
      ) : (
        <Card>
          {events.map((event, index) => {
            const registered = event.myRegistrationStatus === 'REGISTERED';
            return (
              <View key={event.id}>
                <ListRow
                  title={event.title}
                  subtitle={eventSubtitle(event)}
                  meta={`${event.seatsRemaining}/${event.capacity}`}
                />
                <View style={styles.actionRow}>
                  <UiText variant="meta" tone="muted">
                    {statusLabel(event.status)}
                  </UiText>
                  {event.status === 'REGISTRATION_OPEN' && !registered ? (
                    <Button
                      label="Register"
                      variant="secondary"
                      loading={mutating}
                      disabled={event.seatsRemaining <= 0 || isPreview}
                      onPress={() => void register(event.id)}
                    />
                  ) : null}
                  {registered &&
                  event.status !== 'CANCELLED' &&
                  event.status !== 'COMPLETED' &&
                  event.myRegistrationId ? (
                    <Button
                      label="Cancel"
                      variant="text"
                      loading={mutating}
                      disabled={isPreview}
                      onPress={() => void cancel(event.myRegistrationId as string)}
                    />
                  ) : null}
                </View>
                {index < events.length - 1 ? <Divider /> : null}
              </View>
            );
          })}
        </Card>
      )}

      <ScreenSpacer />
      <SectionHeading title="My registrations" />
      {registrations.length === 0 ? (
        <StatePanel
          kind="empty"
          title="No registrations"
          description="Events you join will appear here."
        />
      ) : (
        <Card>
          {registrations.map((entry, index) => (
            <View key={entry.registrationId}>
              <ListRow
                title={entry.event.title}
                subtitle={eventSubtitle(entry.event)}
                meta={entry.attendanceStatus === 'ATTENDED' ? 'Attended' : entry.registrationStatus}
              />
              {index < registrations.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Card>
      )}
      <ScreenSpacer />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
});
