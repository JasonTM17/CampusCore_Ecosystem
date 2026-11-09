import { afterEach, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockApi = { mode: 'preview' as 'preview' | 'live' };
const mockQuery = { value: { data: undefined as unknown, error: null as string | null, warning: null as string | null } };

jest.mock('../../src/api/client', () => ({ apiClient: { get mode() { return mockApi.mode; } } }));
jest.mock('../../src/screens/content/content-api', () => ({ contentApi: { conduct: jest.fn() } }));
jest.mock('../../src/screens/academic/academic-api', () => ({ academicApi: { curriculum: jest.fn() } }));
jest.mock('../../src/screens/content/use-content-query', () => ({
  useContentQuery: () => ({ ...mockQuery.value, errorStatus: null, isLoading: false, isStale: false, reload: jest.fn(async () => {}) }),
}));

import { CertificatesScreen } from '../../src/screens/content/CertificatesScreen';

const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;

const renderThemed = (locale: 'vi' | 'en', element: ReactElement) => render(
  <ThemeProvider forcedScheme="light"><LocaleProvider initialLocale={locale}>{element}</LocaleProvider></ThemeProvider>,
);

afterEach(() => {
  mockApi.mode = 'preview';
  mockQuery.value = { data: undefined, error: null, warning: null };
});

test('certificate preview names the Academic Affairs Office in Vietnamese', async () => {
  await renderThemed('vi', <CertificatesScreen {...props} />);

  expect(screen.getByText('Bản xem trước giấy xác nhận sinh viên')).toBeOnTheScreen();
  expect(screen.getByText('Giấy xác nhận chính thức do')).toBeOnTheScreen();
  expect(screen.getByText('Phòng Đào tạo — HCMUTE')).toBeOnTheScreen();
  expect(screen.queryByText(/Phòng Công tác sinh viên cấp/)).toBeNull();
});

test('certificate preview names the Academic Affairs Office in English', async () => {
  await renderThemed('en', <CertificatesScreen {...props} />);

  expect(screen.getByText('Student certificate preview')).toBeOnTheScreen();
  expect(screen.getByText('Official certificates are issued by')).toBeOnTheScreen();
  expect(screen.getByText('Academic Affairs Office (OAA) — HCMUTE')).toBeOnTheScreen();
});

test('an empty certificate record uses the web preview wording', async () => {
  mockApi.mode = 'live';
  await renderThemed('vi', <CertificatesScreen {...props} />);

  expect(screen.getByText('Chưa đủ thông tin để lập giấy xác nhận')).toBeOnTheScreen();
  expect(screen.getByText(/Phiên đăng nhập chưa mang họ tên/)).toBeOnTheScreen();
});
