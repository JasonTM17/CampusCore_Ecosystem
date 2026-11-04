import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const mockRelease = jest.fn();
const mockPick = jest.fn();
const mockAdapter = {
  capability: () => ({ available: true }),
  pick: (...args: unknown[]) => mockPick(...args),
  share: async () => ({ status: 'done' }),
  save: async () => ({ status: 'done' }),
};

jest.mock('../../src/files/file-adapter', () => ({ getFileAdapter: () => mockAdapter }));
jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' }, campusApi: {} }));
jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: { attempts: { keyFor: () => 'upload-key', settle: () => undefined } },
}));

import { UploadPicker } from '../../src/screens/content/content-ui';
import { DOCUMENT_POLICY } from '../../src/screens/content/attachment-transfer';

const pickedFile = () => ({
  uri: 'file:///cache/attachment-1.pdf',
  name: 'a.pdf',
  sizeBytes: 4,
  mimeType: 'application/pdf',
  release: mockRelease,
});

const renderPicker = (upload: jest.Mock<(...args: unknown[]) => Promise<unknown>>, onUploaded: jest.Mock) => render(
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">
      <UploadPicker intent="test" policy={DOCUMENT_POLICY} upload={upload} onUploaded={onUploaded} />
    </LocaleProvider>
  </ThemeProvider>,
);

beforeEach(() => {
  mockRelease.mockReset();
  mockPick.mockReset();
  mockPick.mockImplementation(async () => ({ status: 'picked', file: pickedFile() }));
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('picked attachment lifecycle', () => {
  test('a successful upload releases the picked cache copy', async () => {
    const upload = jest.fn(async () => ({ id: 'attachment-1' }));
    const onUploaded = jest.fn();
    await renderPicker(upload, onUploaded);

    await fireEvent.press(screen.getByRole('button', { name: 'Chọn tệp' }));
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole('button', { name: 'Tải tệp lên: a.pdf' }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ id: 'attachment-1' }));
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('a.pdf')).toBeNull();
  });

  test('a failed upload keeps the copy for a retry', async () => {
    const upload = jest.fn(async () => { throw new Error('offline'); });
    await renderPicker(upload, jest.fn());

    await fireEvent.press(screen.getByRole('button', { name: 'Chọn tệp' }));
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole('button', { name: 'Tải tệp lên: a.pdf' }));

    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(mockRelease).not.toHaveBeenCalled();
    expect(screen.getByText('a.pdf')).toBeOnTheScreen();
  });

  test('an explicit discard releases the picked cache copy', async () => {
    await renderPicker(jest.fn(), jest.fn());

    await fireEvent.press(screen.getByRole('button', { name: 'Chọn tệp' }));
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole('button', { name: 'Bỏ tệp: a.pdf' }));

    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('a.pdf')).toBeNull();
  });
});
