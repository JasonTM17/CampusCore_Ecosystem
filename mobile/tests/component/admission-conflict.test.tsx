import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { admissionsMessages } from '../../src/i18n/admissions-messages';

const mockApi = { mode: 'live' as 'preview' | 'live' };
let mockApps: Array<Record<string, unknown>> = [];
const mockSave = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockSubmit = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockReload = jest.fn<(...args: unknown[]) => Promise<Array<Record<string, unknown>> | undefined>>(async () => {
  mockApps = mockApps.map((app) => ({ ...app, version: 2, essay: 'Server text after the reload' }));
  return mockApps;
});

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode, get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }; },
  campusApi: {},
  createAssistantClientRequestId: () => 'request-id',
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    const [, bump] = (require('react') as typeof import('react')).useReducer((count: number) => count + 1, 0);
    return {
      data: key === 'content.admissions.mine' ? mockApps : undefined,
      error: null,
      warning: null,
      errorStatus: null,
      isLoading: false,
      isStale: false,
      reload: async () => { await mockReload(); bump(); },
      reloadData: async () => { const result = await mockReload(); bump(); return result; },
      setData: jest.fn(),
    };
  },
}));
jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: {
    attempts: { keyFor: () => 'key', settle: () => {} },
    admissionsApplications: async () => mockApps,
    admissionsSave: (...args: unknown[]) => mockSave(...args),
    admissionsSubmit: (...args: unknown[]) => mockSubmit(...args),
    admissionsWithdraw: jest.fn(async () => undefined),
    admissionsDeleteAttachment: jest.fn(async () => undefined),
    admissionsDownload: jest.fn(async () => new ArrayBuffer(0)),
    admissionsUpload: jest.fn(async () => undefined),
  },
}));

import { AdmissionsScreen } from '../../src/screens/student/AdmissionsScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student', selectedThesisTopicId: null } as MobileScreenProps;

const application = (version: number, essay: string) => ({
  id: 'app-1',
  cycle: '2026-Q1',
  status: 'DRAFT',
  version,
  fullName: 'Nguyễn Văn A',
  dateOfBirth: '2005-01-02',
  schoolName: 'THPT B',
  intendedMajor: 'Công nghệ thông tin',
  essay,
  attachments: [],
  reviews: [],
});

const renderScreen = (element: ReactElement) =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{element}</LocaleProvider>
    </ThemeProvider>,
  );

const openApplication = async () => {
  await renderScreen(<AdmissionsScreen {...props} />);
  await fireEvent.press(await screen.findByRole('button', { name: /2026-Q1/ }));
};

const typedEssay = 'Bài luận tôi vừa viết, chỉ có trên điện thoại.';

beforeEach(() => {
  mockApi.mode = 'live';
  mockApps = [application(1, 'Bản nháp trên máy chủ')];
  mockSave.mockReset();
  mockSave.mockResolvedValue(undefined);
  mockSubmit.mockReset();
  mockSubmit.mockResolvedValue(undefined);
  mockReload.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('admission conflict handling', () => {
  test('a failed submit after saving exposes the reload for its newer draft version', async () => {
    mockSave.mockResolvedValueOnce(application(2, typedEssay));
    mockSubmit.mockRejectedValueOnce(new TypeError('response lost'));
    await openApplication();
    await fireEvent.changeText(screen.getByLabelText(admissionsMessages.vi.essay), typedEssay);
    await fireEvent.press(screen.getByRole('button', { name: admissionsMessages.vi.submit }));
    const confirmations = await screen.findAllByRole('button', { name: admissionsMessages.vi.submit });
    await fireEvent.press(confirmations[confirmations.length - 1]);

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledWith('app-1', 2));
    expect(await screen.findByText(admissionsMessages.vi.stale)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: admissionsMessages.vi.reload })).toBeOnTheScreen();
    expect(mockReload).not.toHaveBeenCalled();
    expect(screen.getByLabelText(admissionsMessages.vi.essay).props.value).toBe(typedEssay);

    mockReload.mockImplementationOnce(async () => {
      mockApps = [application(2, typedEssay)];
      return mockApps;
    });
    await fireEvent.press(screen.getByRole('button', { name: admissionsMessages.vi.reload }));
    await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(admissionsMessages.vi.version.replace('{n}', '2'))).toBeOnTheScreen());
  });

  test('a stale version keeps the typed draft and reloads only on request', async () => {
    mockSave.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409, code: 'STALE_VERSION' }));
    await openApplication();
    await fireEvent.changeText(screen.getByLabelText(admissionsMessages.vi.essay), typedEssay);
    await fireEvent.press(screen.getByRole('button', { name: admissionsMessages.vi.save }));

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(admissionsMessages.vi.stale)).toBeOnTheScreen();
    expect(mockReload).not.toHaveBeenCalled();
    expect(screen.getByLabelText(admissionsMessages.vi.essay).props.value).toBe(typedEssay);
    expect(admissionsMessages.vi.reload).toBeTruthy();
    const reload = await screen.findByRole('button', { name: admissionsMessages.vi.reload });

    await fireEvent.press(reload);
    await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(admissionsMessages.vi.essay).props.value).toBe('Server text after the reload'));
  });

  test('an explicit reload re-seeds when the list already has the returned version', async () => {
    mockSave.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409, code: 'STALE_VERSION' }));
    const view = await renderScreen(<AdmissionsScreen {...props} />);
    await fireEvent.press(await screen.findByRole('button', { name: /2026-Q1/ }));
    await fireEvent.changeText(screen.getByLabelText(admissionsMessages.vi.essay), typedEssay);
    await fireEvent.press(screen.getByRole('button', { name: admissionsMessages.vi.save }));
    await screen.findByText(admissionsMessages.vi.stale);

    mockApps = [application(2, 'Server text from the background refresh')];
    await view.rerender(
      <ThemeProvider forcedScheme="light">
        <LocaleProvider initialLocale="vi"><AdmissionsScreen {...props} /></LocaleProvider>
      </ThemeProvider>,
    );
    mockReload.mockImplementationOnce(async () => {
      mockApps = [application(2, 'Server text after the explicit reload')];
      return mockApps;
    });

    await fireEvent.press(screen.getByRole('button', { name: admissionsMessages.vi.reload }));

    await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(admissionsMessages.vi.essay).props.value).toBe('Server text after the explicit reload'));
    expect(screen.queryByText(admissionsMessages.vi.stale)).toBeNull();
    expect(screen.queryByText(admissionsMessages.vi.failed)).toBeNull();
  });

  test('a failed explicit reload keeps the stale notice and typed draft', async () => {
    mockSave.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409, code: 'STALE_VERSION' }));
    await openApplication();
    await fireEvent.changeText(screen.getByLabelText(admissionsMessages.vi.essay), typedEssay);
    await fireEvent.press(screen.getByRole('button', { name: admissionsMessages.vi.save }));

    await screen.findByText(admissionsMessages.vi.stale);
    mockReload.mockImplementationOnce(async () => undefined);
    await fireEvent.press(screen.getByRole('button', { name: admissionsMessages.vi.reload }));

    await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(admissionsMessages.vi.essay).props.value).toBe(typedEssay);
    expect(screen.getByText(admissionsMessages.vi.stale)).toBeOnTheScreen();
    expect(screen.getByText(admissionsMessages.vi.failed)).toBeOnTheScreen();
  });
});
