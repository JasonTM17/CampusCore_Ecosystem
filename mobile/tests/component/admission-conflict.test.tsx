import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { admissionsMessages } from '../../src/i18n/admissions-messages';

const mockApi = { mode: 'live' as 'preview' | 'live' };
let mockApps: Array<Record<string, unknown>> = [];
const mockSave = jest.fn(async (..._args: unknown[]) => undefined);
const mockReload = jest.fn(async () => {
  mockApps = mockApps.map((app) => ({ ...app, version: 2, essay: 'Server text after the reload' }));
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
      setData: jest.fn(),
    };
  },
}));
jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: {
    attempts: { keyFor: () => 'key', settle: () => {} },
    admissionsApplications: async () => mockApps,
    admissionsSave: (...args: unknown[]) => mockSave(...args),
    admissionsSubmit: jest.fn(async () => undefined),
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
  mockReload.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('admission conflict handling', () => {
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
});
