import { expect, jest, test } from '@jest/globals';

import { createThesisApi } from '../../src/screens/thesis/thesis-api';
import { pickReportFile, saveReportFile } from '../../src/screens/thesis/thesis-files';
import type { ApiClient, ApiDownload } from '../../src/api/client';
import type { FileAdapter } from '../../src/files/file-adapter';

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'preview' } }));

function streamedReport(overrides: Partial<ApiDownload> = {}): ApiDownload {
  return {
    data: new ArrayBuffer(0),
    contentType: 'application/pdf',
    fileName: 'report.pdf',
    headers: new Headers(),
    requestId: 'request-1',
    localUri: 'file:///cache/attachment-report.pdf',
    release: jest.fn(),
    ...overrides,
  };
}

test('the report download asks the transport for the streamed file lane', async () => {
  const download = jest.fn(async () => streamedReport());
  const api = createThesisApi({ download } as unknown as ApiClient);

  await api.downloadReportFile('group-1');

  expect(download).toHaveBeenCalledWith(
    '/thesis/groups/group-1/report/file',
    expect.objectContaining({ nativeFile: true }),
  );
});

test('a rejected file picker becomes a failed outcome', async () => {
  const error = Object.assign(new Error('private picker detail'), { code: 'PICK_FAILED' });
  const adapter: FileAdapter = {
    capability: () => ({ available: true }),
    pick: async () => { throw error; },
    share: jest.fn(async () => ({ status: 'unavailable' as const, reason: 'test' })),
    save: jest.fn(async () => ({ status: 'done' as const })),
  };

  await expect(pickReportFile(adapter)).resolves.toEqual({ status: 'failed', reason: 'PICK_FAILED' });
});

test('the saved report hands the streamed file URI to the adapter without re-encoding', async () => {
  const adapter: FileAdapter = {
    capability: () => ({ available: true }),
    pick: jest.fn(async () => ({ status: 'cancelled' as const })),
    share: jest.fn(async () => ({ status: 'unavailable' as const, reason: 'test' })),
    save: jest.fn(async () => ({ status: 'done' as const })),
  };
  const release = jest.fn();

  const outcome = await saveReportFile(
    adapter,
    async () => streamedReport({ release }),
    'report.pdf',
  );

  expect(outcome).toEqual({ status: 'done' });
  expect(adapter.save).toHaveBeenCalledTimes(1);
  const target = (adapter.save as jest.Mock).mock.calls[0][0] as { uri: string; name: string; mimeType?: string };
  expect(target.uri).toBe('file:///cache/attachment-report.pdf');
  expect(target.uri.startsWith('data:')).toBe(false);
  expect(target.name).toBe('report.pdf');
  expect(release).toHaveBeenCalledTimes(1);
});
