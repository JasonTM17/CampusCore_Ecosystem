import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]), useLocalSearchParams: () => ({}) };
});
jest.mock('../../src/screens/lanes/lane-api', () => ({
  LANE_PAGE_SIZE: 20,
  laneApi: {
    admissionsQueuePaged: jest.fn(),
    admissionsClaim: jest.fn(),
    admissionsReturn: jest.fn(),
    admissionsDecide: jest.fn(),
    careersApplicationsPaged: jest.fn(),
    careersTransition: jest.fn(),
    careersReject: jest.fn(),
    libraryRequests: jest.fn(),
    libraryApprove: jest.fn(),
    libraryIssue: jest.fn(),
    libraryReturn: jest.fn(),
    libraryCancel: jest.fn(),
  },
}));

import { ApplyReviewScreen, CareersDeskScreen, LibraryDeskScreen } from '../../src/screens/lanes/StaffDeskScreens';
import { laneApi } from '../../src/screens/lanes/lane-api';

const api = laneApi as unknown as Record<string, jest.Mock<(...args: unknown[]) => Promise<unknown>>>;
const renderEnglish = async (element: ReactElement) =>
  render(
    <LocaleProvider initialLocale="en">
      <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
    </LocaleProvider>,
  );

const row = (id: string) => ({ id, fullName: `Applicant ${id}`, status: 'SUBMITTED' });
const pageOfRows = (page: number, total: number, hasMore = true) => ({
  items: Array.from({ length: 20 }, (_, index) => row(`p${page}-${index}`)),
  total,
  hasMore,
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('staff desk paging', () => {
  test('admissions asks for wire page 0, shows the total and moves with one-based labels', async () => {
    api.admissionsQueuePaged.mockImplementation(async (_status, paging) => pageOfRows((paging as { page: number }).page, 41));
    await renderEnglish(<ApplyReviewScreen />);

    await waitFor(() => expect(screen.getByText('Page 1/3 · 41 items')).toBeTruthy());
    expect(api.admissionsQueuePaged).toHaveBeenCalledWith(undefined, { page: 0, limit: 20 });

    await fireEvent.press(screen.getByText('Next page'));
    await waitFor(() => expect(screen.getByText('Page 2/3 · 41 items')).toBeTruthy());
    expect(api.admissionsQueuePaged).toHaveBeenLastCalledWith(undefined, { page: 1, limit: 20 });
  });

  test('careers pages independently and falls back to an unknown-total label', async () => {
    api.careersApplicationsPaged.mockResolvedValue({ items: [{ id: 'c1', opportunityTitle: 'Intern' }], hasMore: false });
    await renderEnglish(<CareersDeskScreen />);

    await waitFor(() => expect(screen.getByText('Page 1')).toBeTruthy());
    expect(screen.queryByText(/items/)).toBeNull();
    expect(api.careersApplicationsPaged).toHaveBeenCalledWith(undefined, { page: 0, limit: 20 });
    const next = screen.getByRole('button', { name: 'Next page' });
    expect(next.props.accessibilityState?.disabled).toBe(true);
  });

  test('an empty page past the end steps back one page and fetches it again', async () => {
    let total = 61;
    api.admissionsQueuePaged.mockImplementation(async (_status, paging) => {
      const wirePage = (paging as { page: number }).page;
      if (wirePage === 3) {
        total = 41;
        return { items: [], total, hasMore: false };
      }
      return pageOfRows(wirePage, total);
    });
    await renderEnglish(<ApplyReviewScreen />);

    await waitFor(() => expect(screen.getByText('Page 1/4 · 61 items')).toBeTruthy());
    for (const label of ['Page 2/4 · 61 items', 'Page 3/4 · 61 items']) {
      await fireEvent.press(screen.getByText('Next page'));
      await waitFor(() => expect(screen.getByText(label)).toBeTruthy());
    }
    await fireEvent.press(screen.getByText('Next page'));

    await waitFor(() => expect(screen.getByText('Page 3/3 · 41 items')).toBeTruthy());
    const pages = api.admissionsQueuePaged.mock.calls.map((call) => (call[1] as { page: number }).page);
    expect(pages).toEqual([0, 1, 2, 3, 2]);
  });

  test('the library desk keeps its single unpaged read and shows no pager', async () => {
    api.libraryRequests.mockResolvedValue([{ id: 'loan-1', title: 'Calculus', status: 'REQUESTED', version: 4 }]);
    await renderEnglish(<LibraryDeskScreen />);

    await waitFor(() => expect(screen.getByText('Calculus')).toBeTruthy(), { timeout: 10000 });
    expect(api.libraryRequests).toHaveBeenCalledWith(undefined);
    expect(screen.queryByText('Next page')).toBeNull();
    expect(screen.queryByText(/Page \d/)).toBeNull();
  });
});
