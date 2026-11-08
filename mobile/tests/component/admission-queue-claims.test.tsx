import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const mockSession: { accountId: string | null } = { accountId: 'staff-a' };
let mockRow = {
  id: 'application-1',
  fullName: 'Applicant One',
  status: 'IN_REVIEW',
  claimedBy: 'staff-b' as string | null,
  version: 1,
};
const mockCopy = {
  titles: { 'staff.applyReview': 'Admissions review' },
  empty: 'No applications',
  webForAttachments: 'View attachments on web.',
  openOnWeb: 'Open on web',
  major: 'Major',
  submittedAt: 'Submitted',
  attachments: 'Attachments: {n}',
  claim: 'Claim',
  claimedByAnotherReviewer: 'Claimed by another reviewer',
  returnApplication: 'Return',
  accept: 'Accept',
  reject: 'Reject',
  reason: 'Reason',
  note: 'Note',
};

jest.mock('../../src/session/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../../src/screens/lanes/lane-api', () => ({ laneApi: {} }));
jest.mock('../../src/screens/lanes/lane-ui', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View, Text, Pressable } = jest.requireActual('react-native') as typeof import('react-native');
  return {
    useLanesCopy: () => ({ copy: mockCopy, locale: 'en' }),
    useLaneRequest: () => ({
      data: { items: [mockRow], hasMore: false, total: 1, page: 0, limit: 20 },
      loading: false,
      error: null,
      reload: jest.fn(),
    }),
    useActionRunner: () => ({ request: jest.fn(), banner: null, error: null, busy: false, cancel: jest.fn(), confirm: jest.fn() }),
    LaneShell: ({ list }: { list?: { data: typeof mockRow[]; renderItem: (input: { item: typeof mockRow; index: number }) => React.ReactNode } }) =>
      React.createElement(View, null, ...(list?.data.map((item, index) => list.renderItem({ item, index })) ?? [])),
    QueueCard: ({ title, actions = [], children }: { title?: string; actions?: Array<{ key: string; label: string; onPress: () => void }>; children?: React.ReactNode }) =>
      React.createElement(View, null,
        React.createElement(Text, null, title),
        children,
        ...actions.map((action) => React.createElement(Pressable, {
          key: action.key,
          accessibilityRole: 'button',
          accessibilityLabel: action.label,
          onPress: action.onPress,
        }, React.createElement(Text, null, action.label))),
      ),
    ConfirmSheet: () => null,
    Pager: () => null,
    StatusFilter: () => null,
    laneStyles: { stack: {} },
  };
});

import { ApplyReviewScreen } from '../../src/screens/lanes/StaffDeskScreens';

function renderScreen() {
  return render(
    <LocaleProvider initialLocale="en">
      <ApplyReviewScreen />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockSession.accountId = 'staff-a';
  mockRow = { id: 'application-1', fullName: 'Applicant One', status: 'IN_REVIEW', claimedBy: 'staff-b', version: 1 };
});

afterEach(() => {
  jest.clearAllMocks();
});

test('a reviewer cannot decide or return an application claimed by another reviewer', async () => {
  await renderScreen();

  expect(screen.getByText('Claimed by another reviewer')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Return' })).toBeNull();
});

test('missing owner or session identity also hides review actions', async () => {
  mockRow.claimedBy = null;
  mockSession.accountId = null;
  await renderScreen();

  expect(screen.getByText('Claimed by another reviewer')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Return' })).toBeNull();
});

test('the owner keeps the review actions', async () => {
  mockRow.claimedBy = 'staff-a';
  await renderScreen();

  expect(screen.queryByText('Claimed by another reviewer')).toBeNull();
  expect(screen.getByRole('button', { name: 'Accept' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Reject' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Return' })).toBeOnTheScreen();
});
