import { expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() },
}));

import type { MobileEvent } from '../../src/api/client';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { eventsMessages } from '../../src/i18n/events-messages';
import { EventDetail } from '../../src/screens/content/EventDetail';

const event: MobileEvent = {
  id: 'event-1',
  title: 'Campus workshop',
  organizer: 'CampusCore',
  location: 'Room A',
  status: 'COMPLETED',
  capacity: 40,
  registeredCount: 12,
  seatsRemaining: 28,
  startsAt: '2026-11-01T09:00:00+07:00',
  endsAt: '2026-11-01T10:00:00+07:00',
  myAttendanceStatus: 'ATTENDED',
};

test('event detail shows the current attendance status', async () => {
  await render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">
        <EventDetail event={event} busy={false} flash={null} onBack={() => {}} onRegister={() => {}} onCancel={() => {}} />
      </LocaleProvider>
    </ThemeProvider>,
  );

  expect(screen.getByLabelText(`${eventsMessages.vi.attendance}: ${eventsMessages.vi.statusLabels.ATTENDED}`)).toBeOnTheScreen();
});
