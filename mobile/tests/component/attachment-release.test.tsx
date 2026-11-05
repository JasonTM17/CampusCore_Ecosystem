import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const mockRelease = jest.fn();
const mockPick = jest.fn();
const mockSave = jest.fn(async (..._args: unknown[]) => ({ status: 'done' as const }));
const mockDownloadToDevice = jest.fn();
const mockAdapter = {
  capability: () => ({ available: true }),
  pick: (...args: unknown[]) => mockPick(...args),
  share: async () => ({ status: 'done' }),
  save: (...args: unknown[]) => mockSave(...args),
};

jest.mock('../../src/files/file-adapter', () => ({ getFileAdapter: () => mockAdapter }));
jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' }, campusApi: {} }));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: { sessionEpoch: () => 0 } }));
jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: { attempts: { keyFor: () => 'upload-key', settle: () => undefined } },
}));
jest.mock('../../src/screens/content/attachment-transfer', () => {
  const actual = jest.requireActual('../../src/screens/content/attachment-transfer') as object;
  return { ...actual, downloadToDevice: (...args: unknown[]) => mockDownloadToDevice(...args) };
});

import { AttachmentRow, UploadPicker } from '../../src/screens/content/content-ui';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  mockRelease.mockReset();
  mockPick.mockReset();
  mockSave.mockReset();
  mockSave.mockResolvedValue({ status: 'done' });
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

  test('a pending upload is aborted and its result is ignored after the picker unmounts', async () => {
    const pending = deferred<unknown>();
    const upload = jest.fn<(...args: unknown[]) => Promise<unknown>>(() => pending.promise);
    const onUploaded = jest.fn();
    const view = await renderPicker(upload, onUploaded);

    await fireEvent.press(screen.getByRole('button', { name: 'Chọn tệp' }));
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole('button', { name: 'Tải tệp lên: a.pdf' }));
    await waitFor(() => expect(upload).toHaveBeenCalled());

    const signal = upload.mock.calls[0][2] as AbortSignal | undefined;
    await view.unmount();
    pending.resolve({ id: 'attachment-1' });
    await pending.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onUploaded).not.toHaveBeenCalled();
    expect(signal?.aborted).toBe(true);
  });

  test('a pending download is aborted and never opens save after its row unmounts', async () => {
    const pending = deferred<{ status: 'done' }>();
    mockDownloadToDevice.mockImplementationOnce(() => pending.promise);
    const view = await render(
      <ThemeProvider forcedScheme="light">
        <LocaleProvider initialLocale="vi">
          <AttachmentRow name="a.pdf" fetchBytes={async () => ({ data: new ArrayBuffer(0), contentType: null, fileName: null })} />
        </LocaleProvider>
      </ThemeProvider>,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Tải xuống: a.pdf' }));
    await waitFor(() => expect(mockDownloadToDevice).toHaveBeenCalled());
    const signal = mockDownloadToDevice.mock.calls[0][3] as AbortSignal | undefined;
    await view.unmount();
    pending.resolve({ status: 'done' });
    await pending.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(signal?.aborted).toBe(true);
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
