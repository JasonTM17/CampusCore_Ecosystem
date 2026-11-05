import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { learningMessages } from '../../src/i18n/learning-messages';
import { clearQueryCache, writeQueryCache } from '../../src/hooks/query-cache';
import type { MobileLearningAssignment, MobileLearningSubmission } from '../../src/api/client';

const copy = learningMessages.vi;

type QueryField<T> = T | ((key: string) => T);
interface ScriptedQuery {
  data: QueryField<unknown>;
  error: QueryField<string | null>;
  warning: QueryField<string | null>;
  isLoading: QueryField<boolean>;
}

const mockQuery: { value: ScriptedQuery } = {
  value: { data: undefined, error: null, warning: null, isLoading: false },
};

const mockWrites = {
  submission: jest.fn(async (_submissionId: string) => ({ version: 3 })),
  saveDraft: jest.fn(async (_submissionId: string, _input: unknown) => ({})),
  submit: jest.fn(async (_assignmentId: string, _version: number) => ({})),
  resubmit: jest.fn(async (_assignmentId: string, _input: unknown, _scope: string) => ({})),
};

const mockFileRelease = jest.fn();
const mockFilePick = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockFileAdapter = {
  capability: () => ({ available: true }),
  pick: (...args: unknown[]) => mockFilePick(...args),
  share: async () => ({ status: 'done' as const }),
  save: async () => ({ status: 'done' as const }),
};

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live', get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  campusApi: {},
  createAssistantClientRequestId: () => 'request-id',
  ApiClientError: class ApiClientError extends Error {},
}));

jest.mock('../../src/files/file-adapter', () => ({ getFileAdapter: () => mockFileAdapter }));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    const resolve = (field: unknown) => (typeof field === 'function' ? (field as (key: string) => unknown)(key) : field);
    const value = mockQuery.value;
    return {
      data: resolve(value.data),
      isLoading: resolve(value.isLoading),
      isStale: false,
      error: resolve(value.error),
      warning: resolve(value.warning),
      errorStatus: null,
      reload: jest.fn(async () => undefined),
      setData: jest.fn(),
    };
  },
}));

jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: {
    learningSubmission: (submissionId: string) => mockWrites.submission(submissionId),
    learningRevisions: jest.fn(async () => []),
    learningFeedback: jest.fn(async () => []),
    learningOpenDraft: jest.fn(async () => ({})),
    learningSaveDraft: (submissionId: string, input: unknown) => mockWrites.saveDraft(submissionId, input),
    learningSubmit: (assignmentId: string, version: number) => mockWrites.submit(assignmentId, version),
    learningResubmit: (assignmentId: string, input: unknown, scope: string) => mockWrites.resubmit(assignmentId, input, scope),
    learningDownloadRevision: jest.fn(async () => new ArrayBuffer(0)),
    attempts: { keyFor: () => 'attempt-key', settle: () => undefined },
  },
}));

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));

import { AssignmentDetail } from '../../src/screens/content/AssignmentDetail';

const assignment = (over: Partial<MobileLearningAssignment> = {}): MobileLearningAssignment => ({
  id: 'a-1',
  sectionId: 'sec-1',
  title: 'Bài thực hành 1',
  status: 'PUBLISHED',
  version: 1,
  mySubmissionId: 'sub-1',
  mySubmissionStatus: 'DRAFT',
  ...over,
});

const submission = (over: Record<string, unknown> = {}): MobileLearningSubmission => ({
  id: 'sub-1',
  assignmentId: 'a-1',
  status: 'DRAFT',
  version: 3,
  ...over,
} as MobileLearningSubmission);

const scriptData = (body: unknown): ScriptedQuery => ({
  data: (key: string) => (key.includes('.submission.') ? body : []),
  error: null,
  warning: null,
  isLoading: false,
});

const element = (props: Partial<Parameters<typeof AssignmentDetail>[0]> = {}): ReactElement => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">
      <AssignmentDetail assignment={assignment()} onBack={jest.fn()} onChanged={jest.fn()} {...props} />
    </LocaleProvider>
  </ThemeProvider>
);

const answerField = () => screen.getByLabelText(copy.yourAnswer);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  clearQueryCache();
  mockQuery.value = { data: undefined, error: null, warning: null, isLoading: false };
  mockFilePick.mockReset();
  mockFileRelease.mockReset();
});

describe('assignment server draft', () => {
  test('a saved server draft prefills the empty editor', async () => {
    mockQuery.value = scriptData(submission({ draftText: 'Câu trả lời đã lưu' }));
    await render(element());
    expect(answerField().props.value).toBe('Câu trả lời đã lưu');
  });

  test('saving without edits sends the server draft text, not an empty body', async () => {
    mockQuery.value = scriptData(submission({ draftText: 'Câu trả lời đã lưu' }));
    await render(element());
    await fireEvent.press(screen.getByRole('button', { name: copy.saveDraft }));
    expect(mockWrites.saveDraft).toHaveBeenCalledWith('sub-1', { textBody: 'Câu trả lời đã lưu' });
  });

  test('a save result after leaving the detail view does not publish stale completion', async () => {
    mockQuery.value = scriptData(submission());
    const pending = deferred<Record<string, never>>();
    const onChanged = jest.fn();
    mockWrites.saveDraft.mockImplementationOnce(() => pending.promise);
    const view = await render(element({ onChanged }));
    await fireEvent.changeText(answerField(), 'Câu trả lời');
    await fireEvent.press(screen.getByRole('button', { name: copy.saveDraft }));
    expect(mockWrites.saveDraft).toHaveBeenCalled();
    await view.unmount();
    pending.resolve({});
    await pending.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onChanged).not.toHaveBeenCalled();
  });

  test('a file-only server draft is shown and can be submitted', async () => {
    mockQuery.value = scriptData(submission({ draftFileName: 'answer.pdf', draftContentType: 'application/pdf', draftSizeBytes: 2048 }));
    mockWrites.submission.mockResolvedValue({ version: 4 });
    await render(element());
    expect(screen.getByText('answer.pdf')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: copy.submit }));
    expect(await screen.findByText(copy.submitTitle)).toBeOnTheScreen();
    const confirm = screen.getAllByRole('button', { name: copy.submit });
    await fireEvent.press(confirm[confirm.length - 1]);
    expect(await screen.findByText(copy.submitted)).toBeOnTheScreen();
    expect(mockWrites.submit).toHaveBeenCalledWith('a-1', 4);
  });

  test('a returned submission seeds the editor from the accepted revision', async () => {
    mockQuery.value = {
      data: (key: string) => (key.includes('.submission.')
        ? submission({ status: 'RETURNED', currentRevisionId: 'rev-2' })
        : key.includes('.revisions.')
          ? [
              { id: 'rev-2', revisionNo: 2, textBody: 'Bài làm lần hai', submittedAt: '2026-01-02T00:00:00Z' },
              { id: 'rev-1', revisionNo: 1, textBody: 'Bài làm lần một', submittedAt: '2026-01-01T00:00:00Z' },
            ]
          : []),
      error: null,
      warning: null,
      isLoading: false,
    };
    await render(element({ assignment: assignment({ mySubmissionStatus: 'RETURNED' }) }));
    expect(answerField().props.value).toBe('Bài làm lần hai');
  });

  test('a local draft keeps priority over the server draft', async () => {
    writeQueryCache('learning.draft.a-1', 'Nháp trên máy');
    mockQuery.value = scriptData(submission({ draftText: 'Bản nháp máy chủ' }));
    await render(element());
    expect(answerField().props.value).toBe('Nháp trên máy');
  });

  test('a revalidation keeps typed edits over a newer server draft', async () => {
    mockQuery.value = scriptData(submission({ draftText: 'Phiên bản một' }));
    const view = await render(element());
    await fireEvent.changeText(answerField(), 'Câu trả lời của tôi');
    mockQuery.value = scriptData(submission({ draftText: 'Phiên bản hai', version: 4 }));
    await view.rerender(element());
    expect(answerField().props.value).toBe('Câu trả lời của tôi');
  });

  test('a successful save releases the picked local file copy', async () => {
    mockQuery.value = scriptData(submission());
    mockFilePick.mockResolvedValueOnce({
      status: 'picked',
      file: {
        uri: 'file:///cache/answer.pdf',
        name: 'answer.pdf',
        sizeBytes: 4,
        mimeType: 'application/pdf',
        release: mockFileRelease,
      },
    });
    await render(element());

    await fireEvent.press(screen.getByRole('button', { name: 'Chọn tệp' }));
    await waitFor(() => expect(screen.getByText('answer.pdf')).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole('button', { name: copy.saveDraft }));
    await waitFor(() => expect(screen.queryByText('answer.pdf')).toBeNull());

    expect(mockFileRelease).toHaveBeenCalledTimes(1);
  });

  test('leaving assignment detail releases a still-selected local file copy', async () => {
    mockQuery.value = scriptData(submission());
    mockFilePick.mockResolvedValueOnce({
      status: 'picked',
      file: {
        uri: 'file:///cache/answer.pdf',
        name: 'answer.pdf',
        sizeBytes: 4,
        mimeType: 'application/pdf',
        release: mockFileRelease,
      },
    });
    const view = await render(element());

    await fireEvent.press(screen.getByRole('button', { name: 'Chọn tệp' }));
    await waitFor(() => expect(screen.getByText('answer.pdf')).toBeOnTheScreen());
    await view.unmount();

    expect(mockFileRelease).toHaveBeenCalledTimes(1);
  });
});
