import { StyleSheet, View } from 'react-native';

import { Button, Card, UiText } from '../../components/Ui';
import type { MobileEvent } from '../../api/client';
import { eventsMessages } from '../../i18n/events-messages';
import { fillCopy } from '../../i18n/academic-messages';
import { eventAction } from './content-rules';
import { ContentHero, DetailFrame, FlashNotice, MetaRow, StatusChip, useContentCopy, type Flash } from './content-ui';

export interface EventDetailProps {
  event: MobileEvent;
  busy: boolean;
  flash: Flash | null;
  onBack: () => void;
  onRegister: (event: MobileEvent) => void;
  onCancel: (event: MobileEvent) => void;
}

export function EventDetail({ event, busy, flash, onBack, onRegister, onCancel }: EventDetailProps) {
  const { locale, formatDateTime } = useContentCopy();
  const copy = eventsMessages[locale];
  const action = eventAction(event);
  return (
    <DetailFrame title={copy.details} onBack={onBack}>
      <View style={{ gap: 12 }}>
        <FlashNotice flash={flash} />
        <Card>
          <ContentHero
            title={event.title}
            icon="calendar-star-outline"
            detail={[event.organizer, event.location, formatDateTime(event.startsAt)].filter(Boolean).join(' · ')}
          >
            <View style={styles.heroPills}>
              <StatusChip code={event.myRegistrationStatus === 'REGISTERED' ? 'REGISTERED' : event.status} labels={copy.statusLabels as Record<string, string>} />
            </View>
          </ContentHero>
          {event.description ? <UiText variant="bodyLarge" style={styles.body}>{event.description}</UiText> : null}
          <View style={{ gap: 4, marginTop: 8 }}>
            <MetaRow label={copy.organizer} value={event.organizer} />
            <MetaRow label={copy.location} value={event.location} />
            <MetaRow label={copy.startsAt} value={formatDateTime(event.startsAt)} />
            <MetaRow label={copy.endsAt} value={formatDateTime(event.endsAt)} />
            <MetaRow label={copy.opensAt} value={event.registrationOpensAt ? formatDateTime(event.registrationOpensAt) : null} />
            <MetaRow label={copy.closesAt} value={event.registrationClosesAt ? formatDateTime(event.registrationClosesAt) : null} />
            <MetaRow label={copy.capacity} value={`${event.registeredCount}/${event.capacity} · ${fillCopy(copy.seats, { n: Math.max(0, event.seatsRemaining) })}`} />
          </View>
        </Card>
        {action === 'register' ? <Button label={copy.register} loading={busy} onPress={() => onRegister(event)} /> : null}
        {action === 'cancel' ? <Button label={copy.cancel} variant="secondary" loading={busy} onPress={() => onCancel(event)} /> : null}
        {action === 'full' ? <UiText variant="label" tone="warning">{copy.full}</UiText> : null}
      </View>
    </DetailFrame>
  );
}

const styles = StyleSheet.create({
  heroPills: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  body: { marginTop: 16 },
});
