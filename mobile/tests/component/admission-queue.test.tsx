import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const mockSession = { kind: 'authenticated', role: 'staff', capabilities: [] as string[] };
const mockNavigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() };

jest.mock('../../src/session/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../../src/navigation/router-adapter', () => ({ useMobileNavigation: () => mockNavigation }));
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useLocalSearchParams: () => ({}), useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) };
});
jest.mock('../../src/screens/lanes/lane-api', () => ({
  laneApi: {
    admissionsQueuePaged: jest.fn(),
    admissionsClaim: jest.fn(),
    admissionsReturn: jest.fn(),
    admissionsDecide: jest.fn(),
  },
}));

import { laneApi } from '../../src/screens/lanes/lane-api';
import { ApplyReviewScreen } from '../../src/screens/lanes/StaffDeskScreens';

const api = laneApi as unknown as Record<string, jest.Mock<(...args: unknown[]) => Promise<unknown>>>;
const renderEnglish = (element: ReactElement) => render(
  <LocaleProvider initialLocale="en">
    <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
  </LocaleProvider>,
);

const applications = [
  { id: 'application-2026', status: 'SUBMITTED', fullName: 'Alex Student', applicantEmail: 'alex@example.edu', cycle: '2026-Fall', attachments: [] },
  { id: 'application-2027', status: 'SUBMITTED', fullName: 'Alex Student', applicantEmail: 'alex@example.edu', cycle: '2027-Spring', attachments: [] },
];

beforeEach(() => {
  api.admissionsQueuePaged.mockReset();
  api.admissionsQueuePaged.mockResolvedValue({ items: applications, total: applications.length, hasMore: false });
  api.admissionsClaim.mockReset();
});

describe('admissions queue details', () => {
  test('shows each cycle and includes the selected application cycle in confirmation', async () => {
    await renderEnglish(<ApplyReviewScreen />);
    expect(await screen.findByText('Admission cycle: 2026-Fall')).toBeTruthy();
    expect(screen.getByText('Admission cycle: 2027-Spring')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Claim for review' })[1]);
    expect(screen.getByText(/Alex Student · 2027-Spring/)).toBeTruthy();
  });

  test('does not show the queue attachment count while the server supplies an empty list', async () => {
    await renderEnglish(<ApplyReviewScreen />);
    await waitFor(() => expect(screen.getAllByText('Alex Student')).toHaveLength(2));
    expect(screen.queryByText('Attachments: 0')).toBeNull();
    expect(screen.getByText('View attachments and manage grants on the web.')).toBeTruthy();
  });
});
