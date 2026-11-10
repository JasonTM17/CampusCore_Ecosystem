import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockState: {
  sections: unknown[];
  materials: unknown[];
  assignments: unknown[];
  materialsError: string | null;
} = {
  sections: [],
  materials: [],
  assignments: [],
  materialsError: null,
};

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live', get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  campusApi: {},
  createAssistantClientRequestId: () => 'request-id',
  ApiClientError: class ApiClientError extends Error {},
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    let data: unknown = [];
    let error: string | null = null;
    if (key === 'content.learning.sections') {
      data = mockState.sections;
    } else if (key.startsWith('content.learning.materials.')) {
      data = mockState.materials;
      error = mockState.materialsError;
    } else if (key.startsWith('content.learning.assignments.')) {
      data = mockState.assignments;
    }
    return {
      data,
      error,
      warning: null,
      isLoading: false,
      errorStatus: null,
      reload: jest.fn(async () => {}),
      setData: jest.fn(),
    };
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import { LearningScreen } from '../../src/screens/student/LearningScreen';

const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;
const renderThemed = (element: ReactElement, locale: 'vi' | 'en' = 'vi') => render(
  <ThemeProvider forcedScheme="light"><LocaleProvider initialLocale={locale}>{element}</LocaleProvider></ThemeProvider>,
);

const sampleSection = { sectionId: 'sec-1', courseCode: 'CS101', sectionNumber: '01', courseName: 'Nhập môn lập trình' };
const sampleMaterial = { id: 'm-1', sectionId: 'sec-1', title: 'Tài liệu chương 1', description: 'Đọc kỹ', fileName: 'chuong1.pdf', sizeBytes: 1024 };
const sampleAssignment = {
  id: 'a-1',
  sectionId: 'sec-1',
  title: 'Bài tập tuần 1',
  description: 'Nộp báo cáo',
  status: 'PUBLISHED',
  mySubmissionStatus: null,
  deadlineAt: '2026-11-20T12:00:00Z',
};

beforeEach(() => {
  mockState.sections = [sampleSection];
  mockState.materials = [sampleMaterial];
  mockState.assignments = [sampleAssignment];
  mockState.materialsError = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('LearningScreen web parity', () => {
  test('shows the web learning title and description subtitle in Vietnamese', async () => {
    await renderThemed(<LearningScreen {...props} />, 'vi');

    expect(screen.getByRole('header', { name: 'Học liệu & Bài tập' })).toBeOnTheScreen();
    expect(screen.getByText('Tài liệu môn học, bài tập theo lớp học phần và nộp bài với lịch sử phiên bản bất biến.')).toBeOnTheScreen();
  });

  test('shows the web learning title and description subtitle in English', async () => {
    await renderThemed(<LearningScreen {...props} />, 'en');

    expect(screen.getByRole('header', { name: 'Materials & Assignments' })).toBeOnTheScreen();
    expect(screen.getByText('Course materials, section assignments and submissions with immutable revision history.')).toBeOnTheScreen();
  });

  test('shows the web empty sections copy when student is not enrolled', async () => {
    mockState.sections = [];
    await renderThemed(<LearningScreen {...props} />, 'vi');

    expect(screen.getByText('Bạn chưa có lớp học phần nào đang học.')).toBeOnTheScreen();
  });

  test('shows the web open-assignment call to action on assignment cards', async () => {
    await renderThemed(<LearningScreen {...props} />, 'vi');

    expect(screen.getByText('Mở bài tập')).toBeOnTheScreen();
  });

  test('shows the learning-specific error title and description when materials fail', async () => {
    mockState.materialsError = 'Lỗi mạng';
    await renderThemed(<LearningScreen {...props} />, 'vi');

    expect(screen.getByText('Không thể tải học liệu')).toBeOnTheScreen();
    expect(screen.getByText('Không thể tải học liệu.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeOnTheScreen();
  });
});
