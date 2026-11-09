import { afterEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockQuery = { value: { data: null as unknown, error: null as string | null, warning: null as string | null } };

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' } }));
jest.mock('../../src/screens/content/content-api', () => ({ contentApi: { conduct: jest.fn() } }));
jest.mock('../../src/screens/content/use-content-query', () => ({
  useContentQuery: () => ({ ...mockQuery.value, errorStatus: null, isLoading: false, isStale: false, reload: jest.fn(async () => {}) }),
}));

import { ConductScreen } from '../../src/screens/content/ConductScreen';

const certificateUrl = 'https://example.test/certificates/volunteer.pdf';
const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;

function setRecord() {
  mockQuery.value.data = {
    studentCode: 'S-1',
    cumulativeAverageScore: 85,
    cumulativeClassificationVi: 'Tốt',
    history: [{
      id: 'term-1',
      semesterName: 'Fall 2026',
      totalScore: 82,
      classification: 'GOOD',
      classificationVi: 'Tốt',
      status: 'APPROVED',
      criteria: [],
      activities: [
        { id: 'activity-1', title: 'Volunteer day', points: 2, certificateUrl },
        { id: 'activity-2', title: 'Invalid certificate', points: 1.5, certificateUrl: 'file:///private/certificate.pdf' },
      ],
    }],
  };
}

const renderThemed = (locale: 'vi' | 'en', element: ReactElement) => render(
  <ThemeProvider forcedScheme="light"><LocaleProvider initialLocale={locale}>{element}</LocaleProvider></ThemeProvider>,
);

afterEach(() => {
  jest.restoreAllMocks();
  mockQuery.value = { data: null, error: null, warning: null };
});

test('conduct status and Vietnamese classification are localized', async () => {
  setRecord();
  const vi = await renderThemed('vi', <ConductScreen {...props} />);
  expect(screen.getByText('HCM-UTE • PHÒNG CTSV')).toBeOnTheScreen();
  expect(screen.getByText('Theo dõi điểm ĐRL, 5 tiêu chí đánh giá và hoạt động được duyệt bằng bố cục gọn hơn.')).toBeOnTheScreen();
  expect(screen.getByText('Trạng thái: Đã phê duyệt')).toBeOnTheScreen();
  expect(screen.getByText(/Tổng điểm: 82 · Tốt/)).toBeOnTheScreen();
  vi.unmount();
});

test('conduct status and English classification are localized', async () => {
  setRecord();
  const en = await renderThemed('en', <ConductScreen {...props} />);
  expect(screen.getByText('Status: Approved')).toBeOnTheScreen();
  expect(screen.getByText(/Total score: 82 · Good/)).toBeOnTheScreen();
});

test('English term labels are rewritten like the web and rank codes are named', async () => {
  mockQuery.value.data = {
    studentCode: 'S-1',
    cumulativeAverageScore: 91,
    cumulativeClassificationVi: null,
    history: [{
      id: 'term-1',
      semesterName: 'Học kỳ 1 năm học 2024-2025',
      totalScore: 91,
      classification: 'XUAT_SAC',
      classificationVi: null,
      status: 'PENDING',
      criteria: [],
      activities: [],
    }],
  };
  await renderThemed('en', <ConductScreen {...props} />);

  expect(screen.getAllByText('Semester 1, 2024-2025').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Excellent').length).toBeGreaterThan(0);
  expect(screen.queryByText('XUAT_SAC')).toBeNull();
  expect(screen.queryByText(/Học kỳ 1 năm học/)).toBeNull();
  expect(screen.getByText('Status: Pending approval')).toBeOnTheScreen();
});

test('Vietnamese term labels are printed unchanged', async () => {
  mockQuery.value.data = {
    studentCode: 'S-1',
    history: [{
      id: 'term-1',
      semesterName: 'Học kỳ 1 năm học 2024-2025',
      totalScore: 91,
      classification: 'KHA',
      classificationVi: 'Khá',
      status: 'APPROVED',
      criteria: [],
      activities: [],
    }],
  };
  await renderThemed('vi', <ConductScreen {...props} />);

  expect(screen.getAllByText('Học kỳ 1 năm học 2024-2025').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Khá').length).toBeGreaterThan(0);
});

test('conduct shows the scholarship check, bonus total and classification scale', async () => {
  setRecord();
  await renderThemed('vi', <ConductScreen {...props} />);

  expect(screen.getByText('Điều kiện xét học bổng:')).toBeOnTheScreen();
  expect(screen.getByText('Đạt chuẩn')).toBeOnTheScreen();
  expect(screen.getByText('(Yêu cầu tối thiểu 70 điểm)')).toBeOnTheScreen();
  expect(screen.getByText(/\+3,5 điểm cộng/)).toBeOnTheScreen();
  expect(screen.getByText('Khung xếp loại rèn luyện')).toBeOnTheScreen();
  expect(screen.getByText('90-100 điểm')).toBeOnTheScreen();
  expect(screen.getByText('80-89 điểm')).toBeOnTheScreen();
  expect(screen.getByText('65-79 điểm')).toBeOnTheScreen();
  expect(screen.getByText('50-64 điểm')).toBeOnTheScreen();
  expect(screen.getByText('< 50 điểm')).toBeOnTheScreen();
});

test('conduct criteria keep the web descriptions, score unit and reached percentage', async () => {
  mockQuery.value.data = {
    studentCode: 'S-1',
    history: [{
      id: 'term-1',
      semesterName: 'Fall 2026',
      totalScore: 80,
      classification: 'TOT',
      classificationVi: 'Tốt',
      status: 'APPROVED',
      criteria: [{ code: 'CRITERIA_1', nameVi: 'Tiêu chí 1', nameEn: 'Criterion 1', score: 40, maxScore: 50 }],
      activities: [],
    }],
  };
  await renderThemed('vi', <ConductScreen {...props} />);

  expect(screen.getByText('5 tiêu chí rèn luyện')).toBeOnTheScreen();
  expect(screen.getByText('Chuyên cần, bài tập, thái độ học tập và tham gia nghiên cứu khoa học.')).toBeOnTheScreen();
  expect(screen.getByText(/Đạt 80%/)).toBeOnTheScreen();
});

test('valid conduct certificate links open externally and invalid schemes have no action', async () => {
  setRecord();
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await renderThemed('en', <ConductScreen {...props} />);

  expect(screen.getByRole('button', { name: 'View certificate: Volunteer day' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'View certificate: Invalid certificate' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'View certificate: Volunteer day' }));
  await waitFor(() => expect(openURL).toHaveBeenCalledWith(certificateUrl));
});

test('certificate link launch failures show localized feedback', async () => {
  setRecord();
  jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
  await renderThemed('vi', <ConductScreen {...props} />);

  await fireEvent.press(screen.getByRole('button', { name: 'Xem giấy chứng nhận: Volunteer day' }));
  expect(await screen.findByText('Không mở được giấy chứng nhận. Vui lòng thử lại.')).toBeOnTheScreen();
});

test('conduct screen with null average and no terms shows empty state', async () => {
  mockQuery.value.data = {
    studentCode: 'S-1',
    cumulativeAverageScore: null,
    cumulativeClassificationVi: null,
    currentSemester: null,
    history: [],
  };
  await renderThemed('vi', <ConductScreen {...props} />);
  expect(screen.getByText('Chưa có điểm rèn luyện')).toBeOnTheScreen();
});
