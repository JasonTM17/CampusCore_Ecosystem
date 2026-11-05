import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { admissionsMessages } from '../../src/i18n/admissions-messages';

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live', get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  campusApi: {},
  createAssistantClientRequestId: () => 'request-id',
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: {
    admissionsDownload: jest.fn(async () => new ArrayBuffer(0)),
    admissionsUpload: jest.fn(async () => undefined),
  },
}));

import { AdmissionDetail } from '../../src/screens/content/AdmissionDetail';
import type { AdmissionApplicationView } from '../../src/screens/content/content-api';

const typedEssay = 'Bài luận chỉ có trên thiết bị.';

const application = (version: number, essay: string): AdmissionApplicationView => ({
  id: 'app-1',
  applicantUserId: 'user-1',
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
  createdAt: '2026-01-01T00:00:00Z',
});

const element = (version: number, essay: string, formEpoch = 0): ReactElement => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">
      <AdmissionDetail
        application={application(version, essay)}
        formEpoch={formEpoch}
        busy={false}
        preview={false}
        flash={null}
        onBack={jest.fn()}
        onSave={jest.fn()}
        onSubmit={jest.fn()}
        onWithdraw={jest.fn()}
        onUploaded={jest.fn()}
        onDeleteFile={jest.fn()}
      />
    </LocaleProvider>
  </ThemeProvider>
);

const essayField = () => screen.getByLabelText(admissionsMessages.vi.essay);

describe('admission draft preservation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('an attachment version bump keeps the typed draft', async () => {
    const view = await render(element(3, 'Bản nháp trên máy chủ'));
    await fireEvent.changeText(essayField(), typedEssay);

    await view.rerender(element(4, 'Bản nháp trên máy chủ'));

    expect(essayField().props.value).toBe(typedEssay);
  });

  test('an explicit reload re-seeds the form from the server', async () => {
    const view = await render(element(3, 'Bản nháp cũ'));
    await fireEvent.changeText(essayField(), typedEssay);

    await view.rerender(element(4, 'Bản nháp sau khi tải lại', 1));

    expect(essayField().props.value).toBe('Bản nháp sau khi tải lại');
  });

  test('the date field accepts the current campus date before UTC midnight', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-05T18:00:00.000Z'));
    await render(element(3, 'Bản nháp trên máy chủ'));

    await fireEvent.press(screen.getByRole('button', { name: /Ngày sinh/ }));
    await fireEvent.changeText(screen.getByLabelText('Chọn ngày'), '06/11/2026');
    await fireEvent.press(screen.getByRole('button', { name: 'Áp dụng' }));

    expect(screen.queryByText(/Ngày không được muộn hơn/)).toBeNull();
    expect(screen.getByRole('button', { name: /Ngày sinh: 06\/11\/2026/ })).toBeOnTheScreen();
  });
});
