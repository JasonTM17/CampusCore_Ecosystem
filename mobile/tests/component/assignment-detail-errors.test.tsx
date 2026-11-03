import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { learningMessages } from '../../src/i18n/learning-messages';
import { clearQueryCache } from '../../src/hooks/query-cache';
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
const mockReloads: Record<string, ReturnType<typeof jest.fn>> = {};

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live', get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  campusApi: {},
  createAssistantClientRequestId: () => 'request-id',
  ApiClientError: class ApiClientError extends Error {},
}));

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
      reload: mockReloads[key] ?? (mockReloads[key] = jest.fn(async () => undefined)),
      setData: jest.fn(),
    };
  },
}));

jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: {
    learningSubmission: jest.fn(async () => ({ version: 3 })),
    learningRevisions: jest.fn(async () => []),
    learningFeedback: jest.fn(async () => []),
    learningOpenDraft: jest.fn(async () => ({})),
    learningSaveDraft: jest.fn(async () => ({})),
    learningSubmit: jest.fn(async () => ({})),
    learningResubmit: jest.fn(async () => ({})),
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
  mySubmissionStatus: 'RETURNED',
  ...over,
});

const submission = (over: Record<string, unknown> = {}): MobileLearningSubmission => ({
  id: 'sub-1',
  assignmentId: 'a-1',
  status: 'RETURNED',
  version: 3,
  ...over,
} as MobileLearningSubmission);

const element = (): ReactElement => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">
      <AssignmentDetail assignment={assignment()} onBack={jest.fn()} onChanged={jest.fn()} />
    </LocaleProvider>
  </ThemeProvider>
);

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  clearQueryCache();
  mockQuery.value = { data: undefined, error: null, warning: null, isLoading: false };
  for (const key of Object.keys(mockReloads)) delete mockReloads[key];
});

describe('assignment detail read states', () => {
  test('a failed feedback read shows an error with retry, not the empty copy', async () => {
    mockQuery.value = {
      data: (key: string) => (key.includes('.submission.') ? submission() : key.includes('.revisions.') ? [] : undefined),
      error: (key: string) => (key.includes('.feedback.') ? 'Không thể tải dữ liệu' : null),
      warning: null,
      isLoading: false,
    };
    await render(element());
    expect(screen.getByText('Không thể tải dữ liệu')).toBeOnTheScreen();
    expect(screen.queryByText(copy.emptyFeedback)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
    expect(mockReloads['content.learning.feedback.sub-1.0']).toHaveBeenCalledTimes(1);
  });

  test('a failed revisions read retries that section only', async () => {
    mockQuery.value = {
      data: (key: string) => (key.includes('.submission.') ? submission() : key.includes('.feedback.') ? [] : undefined),
      error: (key: string) => (key.includes('.revisions.') ? 'Không thể tải dữ liệu' : null),
      warning: null,
      isLoading: false,
    };
    await render(element());
    expect(screen.getByText('Không thể tải dữ liệu')).toBeOnTheScreen();
    expect(screen.queryByText(copy.emptyRevisions)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
    expect(mockReloads['content.learning.revisions.sub-1.0']).toHaveBeenCalledTimes(1);
    expect(mockReloads['content.learning.feedback.sub-1.0']).not.toHaveBeenCalled();
  });

  test('a loading revisions read shows a loading row, not the empty copy', async () => {
    mockQuery.value = {
      data: (key: string) => (key.includes('.submission.') ? submission() : key.includes('.feedback.') ? [] : undefined),
      error: null,
      warning: null,
      isLoading: (key: string) => key.includes('.revisions.'),
    };
    await render(element());
    expect(screen.getByText(copy.loading)).toBeOnTheScreen();
    expect(screen.queryByText(copy.emptyRevisions)).toBeNull();
  });

  test('settled empty reads still show the empty copy', async () => {
    mockQuery.value = {
      data: (key: string) => (key.includes('.submission.') ? submission() : []),
      error: null,
      warning: null,
      isLoading: false,
    };
    await render(element());
    expect(screen.getByText(copy.emptyRevisions)).toBeOnTheScreen();
    expect(screen.getByText(copy.emptyFeedback)).toBeOnTheScreen();
  });
});
