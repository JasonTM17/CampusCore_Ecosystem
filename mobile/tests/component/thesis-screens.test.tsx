import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';

const mockApi: Record<string, jest.Mock<(...args: any[]) => Promise<any>>> = {};
for (const name of [
  'rounds', 'topics', 'topic', 'supervisors', 'myGroups', 'progress', 'searchStudents',
  'createGroup', 'addMember', 'removeMember', 'assignTopic',
  'report', 'submitReportLink', 'submitReportFile', 'updateReport', 'removeReportFile', 'downloadReportFile',
]) {
  mockApi[name] = jest.fn<(...args: any[]) => Promise<any>>();
}

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live' },
  campusApi: { profile: async () => ({ id: 'u1', email: 'a@b.c', studentId: 's1' }) },
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/screens/thesis/thesis-api', () => ({
  thesisApi: new Proxy({}, { get: (_target, key: string) => (...args: unknown[]) => mockApi[key](...args) }),
}));
// Runs the fetcher like the real hook and keeps the previous key's data while a new key loads.
jest.mock('../../src/hooks/useScreenQuery', () => {
  const React = require('react');
  return {
    useScreenQuery: (key: string, fetcher: () => Promise<unknown>, options: { enabled?: boolean; mapError?: (e: unknown) => string } = {}) => {
      const enabled = options.enabled !== false;
      const [state, setState] = React.useState({ data: undefined, error: null, loading: enabled });
      const fetcherRef = React.useRef(fetcher);
      fetcherRef.current = fetcher;
      const optionsRef = React.useRef(options);
      optionsRef.current = options;
      const reload = React.useCallback(async () => {
        if (!enabled) return;
        try {
          const data = await fetcherRef.current();
          setState({ data, error: null, loading: false });
        } catch (error) {
          setState((current: { data: unknown }) => ({ data: current.data, error: optionsRef.current.mapError?.(error) ?? 'error', loading: false }));
        }
      }, [enabled]);
      React.useEffect(() => {
        if (!enabled) return;
        setState((current: { data: unknown; error: unknown }) => ({ ...current, loading: true }));
        void reload();
      }, [key, enabled, reload]);
      return {
        data: state.data,
        isLoading: state.loading,
        isStale: false,
        error: state.error,
        warning: null,
        errorStatus: null,
        reload,
        setData: (data: unknown) => setState((current: object) => ({ ...current, data })),
      };
    },
  };
});

import { apiClient } from '../../src/api/client';
import { peekAssistantEntryScope, consumeAssistantEntryScope } from '../../src/assistant/entry-scope';
import { createUnavailableFileAdapter, setFileAdapter, type FileAdapter } from '../../src/files/file-adapter';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { thesisMessages } from '../../src/i18n/thesis-messages';
import type { MobileScreenProps } from '../../src/navigation/types';
import { selectThesisRound } from '../../src/screens/thesis/thesis-selection';
import { statusTone } from '../../src/screens/thesis/thesis-model';
import { TopicCard } from '../../src/screens/thesis/thesis-ui';
import {
  ThesisAdvisorsScreen,
  ThesisDetailScreen,
  ThesisProgressScreen,
  ThesisRegistrationScreen,
  ThesisRoundScreen,
  ThesisTopicsScreen,
} from '../../src/screens/thesis/ThesisScreens';

const mockClient = apiClient as unknown as { mode: 'live' | 'preview' };
const copy = thesisMessages.vi;
const navigate = jest.fn();
const navigation = { navigate, signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const baseProps = { navigation, role: 'student', selectedThesisTopicId: null } as MobileScreenProps;
const renderThemed = (el: ReactElement) => render(<ThemeProvider forcedScheme="light">{el}</ThemeProvider>);
const renderEnglish = (el: ReactElement) =>
  render(
    <LocaleProvider initialLocale="en">
      <ThemeProvider forcedScheme="light">{el}</ThemeProvider>
    </LocaleProvider>,
  );
function setWidth(w: number, fontScale = 1) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: w, height: 800, scale: 2, fontScale } as ReturnType<typeof Dimensions.get>);
}

async function browseAllTopics(label = 'Xem tất cả đề tài đợt này') {
  await fireEvent.press(await screen.findByRole('button', { name: label }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function pressTwiceBeforeCommit(button: unknown) {
  const originalError = console.error;
  const warning = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (String(message).includes('overlapping act() calls')) return;
    originalError(message, ...args);
  });
  try {
    await act(async () => {
      fireEvent.press(button as never);
      fireEvent.press(button as never);
    });
  } finally {
    warning.mockRestore();
  }
}

const round = (id: string, name: string, status: string, over: Record<string, unknown> = {}) => ({
  id, name, status,
  registrationStart: new Date(Date.now() - 86_400_000).toISOString(),
  registrationEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  thesisType: 'KLTN',
  ...over,
});
const ROUNDS = [round('r1', 'Đợt 1', 'RESULTS_PUBLISHED'), round('r2', 'Đợt 2', 'REGISTRATION_OPEN')];
const topic = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id, roundId: 'r2', departmentId: 'CNTT', title, description: `Mô tả ${title}`, maxGroups: 3, status: 'PUBLISHED', ...over,
});
const TOPIC_A = topic('t1', 'Trợ lý học vụ');
const TOPIC_B = topic('t2', 'Thư viện di động', { departmentId: 'KTPM' });
const TOPIC_C = topic('t3', 'Phân tích điểm danh');
const SUPERVISORS = [{ lecturerId: 'l1', supervisorOrder: 1, firstName: 'Nam', lastName: 'Phạm', email: 'nam@example.edu' }];

const member = (studentId: string, displayName: string, isLeader = false) => ({ studentId, displayName, isLeader });
const group = (over: Record<string, unknown> = {}) => ({
  id: 'g1', roundId: 'r2', leaderStudentId: 's1', topicId: null, status: 'DRAFT', approvalStatus: 'PENDING',
  memberStudentIds: ['s1', 's2', 's3'],
  members: [member('s1', 'Nguyễn An', true), member('s2', 'Trần Bảo'), member('s3', 'Lê Hà')],
  ...over,
});
const progress = (over: Record<string, unknown> = {}) => ({
  roundId: 'r2', roundStatus: 'REGISTRATION_OPEN', participationState: 'PARTICIPATING',
  currentMilestone: 'TOPIC_ASSIGNED', completedMilestones: ['ROUND_SELECTED', 'GROUP_CREATED'],
  attentionState: 'NONE', groupId: 'g1', memberCount: 3, ...over,
});
const page = (items: unknown[], hasMore = false, total = items.length) => ({ items, hasMore, total });

function seed(options: { group?: unknown; progress?: unknown; rounds?: unknown[]; topics?: unknown[] } = {}) {
  mockApi.rounds.mockResolvedValue(page(options.rounds ?? ROUNDS));
  mockApi.topics.mockResolvedValue(page(options.topics ?? [TOPIC_A, TOPIC_B]));
  mockApi.topic.mockResolvedValue(TOPIC_A);
  mockApi.supervisors.mockResolvedValue(SUPERVISORS);
  mockApi.myGroups.mockResolvedValue(page(options.group ? [options.group] : []));
  mockApi.progress.mockResolvedValue(options.progress ?? progress({ participationState: 'NOT_PARTICIPATING', attentionState: 'NOT_PARTICIPATING', groupId: null, completedMilestones: ['ROUND_SELECTED'] }));
  mockApi.report.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
}

beforeEach(() => {
  mockClient.mode = 'live';
  selectThesisRound(null);
  consumeAssistantEntryScope();
  setFileAdapter();
  for (const fn of Object.values(mockApi)) fn.mockReset();
  seed();
});
afterEach(() => { jest.restoreAllMocks(); navigate.mockClear(); });

describe('topics, round and advisors', () => {
  test('keeps topic content while hiding the raw department id', async () => {
    const rawIdTopic = topic('topic-test', 'Visible topic', {
      departmentId: 'department-demo',
      description: 'Visible description',
    });
    await renderThemed(<TopicCard topic={rawIdTopic} copy={copy} onOpen={navigate} />);

    expect(screen.getByText('Visible topic')).toBeOnTheScreen();
    expect(screen.getByText('Visible description')).toBeOnTheScreen();
    expect(screen.getByText('Đã công bố')).toBeOnTheScreen();
    expect(screen.getByText('3 nhóm đề tài')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Chi tiết đề tài: Visible topic' })).toBeOnTheScreen();
    expect(screen.queryByText('department-demo')).toBeNull();
  });

  test.each([[360, 1, 1], [393, 2, 1], [600, 1, 1], [839, 1.3, 1], [840, 1, 2], [1000, 1, 2], [1000, 1.3, 1], [1000, 2, 1]])(
    'uses %s dp and font %s to choose %s topic columns',
    async (width, fontScale, columns) => {
      setWidth(width, fontScale);
      await renderThemed(<ThesisTopicsScreen {...baseProps} />);
      await browseAllTopics();
      await screen.findByText(TOPIC_A.title);
      let cell = screen.getByRole('button', { name: `${copy.openTopic}: ${TOPIC_A.title}` }).parent;
      const expectedWidth = columns === 2 ? '48.5%' : '100%';
      while (cell && StyleSheet.flatten(cell.props.style)?.width !== expectedWidth) cell = cell.parent;
      expect(cell).toBeTruthy();
    },
  );

  test('opens on the registration round and waits for a search before listing topics', async () => {
    setWidth(360);
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    expect(await screen.findByText(copy.topicsTitle)).toBeOnTheScreen();
    expect(await screen.findByText('Tìm kiếm để xem danh mục đề tài')).toBeOnTheScreen();
    expect(screen.queryByText('Trợ lý học vụ')).toBeNull();
    expect(mockApi.topics).not.toHaveBeenCalled();
    await browseAllTopics();
    expect(await screen.findByText('Trợ lý học vụ')).toBeOnTheScreen();
    expect(screen.getByText('Thư viện di động')).toBeOnTheScreen();
    expect(mockApi.topics).toHaveBeenCalledWith('r2', { page: 0, limit: 20 });
    expect(screen.getByText('Đợt 2')).toBeOnTheScreen();
  });

  test('the catalogue gate offers the seven suggested fields and searches without the parenthetical', async () => {
    setWidth(360);
    const pills = [
      'Trí tuệ nhân tạo (AI)',
      'Phần mềm & Web',
      'Cơ điện tử & Robot',
      'Hệ thống thông tin',
      'IoT & Viễn thông',
      'Kỹ thuật Ô tô',
      'Xây dựng',
    ];
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    expect(await screen.findByText('Bạn có thể nhập từ khóa, chọn chuyên ngành gợi ý hoặc bấm "Xem tất cả đề tài đợt này".')).toBeOnTheScreen();
    for (const pill of pills) expect(screen.getByRole('button', { name: pill })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Trí tuệ nhân tạo (AI)' }));
    await waitFor(() => expect(mockApi.topics).toHaveBeenLastCalledWith('r2', { page: 0, limit: 20, search: 'Trí tuệ nhân tạo' }));
    expect(await screen.findByText('Trợ lý học vụ')).toBeOnTheScreen();
  });

  test('search asks the server and renders a match that is not on the first page', async () => {
    setWidth(360);
    mockApi.topics.mockImplementation(async (_roundId: string, options: { page?: number; search?: string } = {}) => {
      if (options.search !== 'tro ly') return page([TOPIC_B], true, 21);
      return options.page ? page([topic('t9', 'Trợ lý học vụ nâng cao')], false, 2) : page([topic('t8', 'Trợ lý học vụ cơ bản')], true, 2);
    });
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    await browseAllTopics();
    await screen.findByText('Thư viện di động');
    await fireEvent.changeText(screen.getByLabelText(copy.searchLabel), 'tro ly');
    expect(await screen.findByText('Trợ lý học vụ cơ bản')).toBeOnTheScreen();
    expect(mockApi.topics).toHaveBeenLastCalledWith('r2', { page: 0, limit: 20, search: 'tro ly' });
    expect(screen.queryByText('Thư viện di động')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: copy.loadMore }));
    expect(await screen.findByText('Trợ lý học vụ nâng cao')).toBeOnTheScreen();
    expect(mockApi.topics).toHaveBeenLastCalledWith('r2', { page: 1, limit: 20, search: 'tro ly' });
  });

  test('a search the server reports as empty shows the filtered empty state', async () => {
    setWidth(360);
    mockApi.topics.mockImplementation(async (_roundId: string, options: { search?: string } = {}) => (
      options.search ? page([], false, 0) : page([TOPIC_A, TOPIC_B], false, 2)
    ));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    await browseAllTopics();
    await screen.findByText('Trợ lý học vụ');
    await fireEvent.changeText(screen.getByLabelText(copy.searchLabel), 'khong co');
    expect(await screen.findByText(copy.emptyTopicsFiltered)).toBeOnTheScreen();
    expect(mockApi.topics).toHaveBeenLastCalledWith('r2', { page: 0, limit: 20, search: 'khong co' });
  });

  test('a long list pages in on request and appends without duplicates', async () => {
    setWidth(360);
    mockApi.topics.mockResolvedValueOnce(page([TOPIC_A, TOPIC_B], true, 3)).mockResolvedValueOnce(page([TOPIC_B, TOPIC_C], false, 3));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    await browseAllTopics();
    await fireEvent.press(await screen.findByRole('button', { name: copy.loadMore }));
    expect(await screen.findByText('Phân tích điểm danh')).toBeOnTheScreen();
    expect(screen.getAllByText('Thư viện di động')).toHaveLength(1);
    expect(mockApi.topics).toHaveBeenLastCalledWith('r2', { page: 1, limit: 20 });
    expect(screen.queryByRole('button', { name: copy.loadMore })).toBeNull();
  });

  test('an empty round says so', async () => {
    setWidth(360);
    mockApi.topics.mockResolvedValueOnce(page([]));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    await browseAllTopics();
    expect(await screen.findByText(copy.emptyTopics)).toBeOnTheScreen();
  });

  test('a failed read shows student-safe copy and recovers on retry', async () => {
    setWidth(360);
    mockApi.topics.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 })).mockResolvedValueOnce(page([TOPIC_A]));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    await browseAllTopics();
    expect(await screen.findByText(copy.errors.unavailable)).toBeOnTheScreen();
    expect(screen.queryByText('boom')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText('Trợ lý học vụ')).toBeOnTheScreen();
  });

  test('a resource 401 stays a retryable read error and never claims an expired session', async () => {
    setWidth(360);
    mockApi.topics
      .mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401, code: 'HTTP_401' }))
      .mockResolvedValueOnce(page([TOPIC_A]));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    await browseAllTopics();
    expect(await screen.findByText(copy.errors.generic)).toBeOnTheScreen();
    expect(screen.queryByText(/Phiên đã hết hạn/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText('Trợ lý học vụ')).toBeOnTheScreen();
    expect(mockApi.topics).toHaveBeenCalledTimes(2);
  });

  test('no rounds shows the empty state', async () => {
    setWidth(360);
    mockApi.rounds.mockResolvedValueOnce(page([]));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    expect(await screen.findByText(copy.noRounds)).toBeOnTheScreen();
  });

  test('a forbidden read shows the denied copy', async () => {
    setWidth(360);
    mockApi.rounds.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 403 }));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    expect(await screen.findByText(copy.errors.forbidden)).toBeOnTheScreen();
  });

  test('switching the round reloads that round and never shows the previous round topics', async () => {
    setWidth(360);
    mockApi.topics.mockImplementation(async (roundId: string) => page(roundId === 'r1' ? [topic('old', 'Đề tài cũ', { roundId: 'r1' })] : [TOPIC_A]));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    await browseAllTopics();
    await screen.findByText('Trợ lý học vụ');
    await fireEvent.press(screen.getByRole('button', { name: copy.roundChange }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Đợt 1,/ }));
    expect(await screen.findByText('Đề tài cũ')).toBeOnTheScreen();
    expect(screen.queryByText('Trợ lý học vụ')).toBeNull();
    expect(mockApi.topics).toHaveBeenCalledWith('r1', { page: 0, limit: 20 });
  });

  test('the round view shows the dates and students see the staff-only advisor state', async () => {
    setWidth(360);
    mockApi.supervisors.mockImplementation(async (topicId: string) => (
      topicId === 't1' ? SUPERVISORS : [...SUPERVISORS, { lecturerId: 'l2', supervisorOrder: 2, firstName: 'Lan', lastName: 'Võ', email: null }]
    ));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    await fireEvent.press(screen.getByRole('tab', { name: copy.tabRound }));
    expect(await screen.findByText(copy.roundRegistration)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: copy.tabAdvisors }));
    expect(await screen.findByText('Mục này dành cho giảng viên và quản trị viên')).toBeOnTheScreen();
    expect(screen.getByText('Thông tin người hướng dẫn theo từng đề tài có trong Danh mục đề tài — nơi bạn chọn đề tài và xem giảng viên phụ trách.')).toBeOnTheScreen();
    expect(screen.queryByText('Phạm Nam')).toBeNull();
    expect(mockApi.supervisors).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Mở danh mục đề tài' }));
    expect(await screen.findByText('Tìm kiếm để xem danh mục đề tài')).toBeOnTheScreen();
  });

  test('a lecturer sees the derived advisor directory', async () => {
    setWidth(360);
    mockApi.supervisors.mockImplementation(async (topicId: string) => (
      topicId === 't1' ? SUPERVISORS : [...SUPERVISORS, { lecturerId: 'l2', supervisorOrder: 2, firstName: 'Lan', lastName: 'Võ', email: null }]
    ));
    await renderThemed(<ThesisTopicsScreen {...baseProps} role="lecturer" />);
    await screen.findByText('Đợt 2');
    await fireEvent.press(screen.getByRole('tab', { name: copy.tabAdvisors }));
    expect(await screen.findByText('Phạm Nam')).toBeOnTheScreen();
    expect(screen.getByText('Võ Lan')).toBeOnTheScreen();
    expect(screen.getByText('2 đề tài')).toBeOnTheScreen();
  });

  test('advisor topics load one page at a time after the first page is visible', async () => {
    setWidth(360);
    const topics = Array.from({ length: 60 }, (_, index) => topic(`advisor-${index}`, `Topic ${index}`));
    mockApi.topics.mockImplementation(async (_roundId: string, options: { page?: number; limit?: number } = {}) => {
      const start = (options.page ?? 0) * (options.limit ?? 20);
      const items = topics.slice(start, start + (options.limit ?? 20));
      return page(items, start + items.length < topics.length, topics.length);
    });
    mockApi.supervisors.mockImplementation(async (topicId: string) => {
      const index = Number(topicId.slice('advisor-'.length));
      return [{ lecturerId: `lecturer-${index}`, supervisorOrder: 1, firstName: `Advisor ${index}`, lastName: 'Lecturer', email: null }];
    });
    await renderThemed(<ThesisTopicsScreen {...baseProps} role="lecturer" />);
    await screen.findByText('Đợt 2');
    await fireEvent.press(screen.getByRole('tab', { name: copy.tabAdvisors }));

    expect(await screen.findByText('Lecturer Advisor 0')).toBeOnTheScreen();
    expect(mockApi.topics).toHaveBeenCalledWith('r2', { page: 0, limit: 20 });
    expect(mockApi.supervisors).toHaveBeenCalledTimes(20);
    expect(mockApi.topics).not.toHaveBeenCalledWith('r2', { page: 1, limit: 20 });

    await fireEvent.press(screen.getByRole('button', { name: copy.loadMore }));
    expect(await screen.findByText('Lecturer Advisor 20')).toBeOnTheScreen();
    expect(mockApi.topics).toHaveBeenCalledWith('r2', { page: 1, limit: 20 });
    expect(mockApi.supervisors).toHaveBeenCalledTimes(40);
  });

  test('advisor cards are passed as rows to the virtualized list', async () => {
    setWidth(360);
    const topics = Array.from({ length: 60 }, (_, index) => topic(`advisor-${index}`, `Topic ${index}`));
    mockApi.topics.mockImplementation(async () => page(topics, false, topics.length));
    mockApi.supervisors.mockImplementation(async (topicId: string) => {
      const index = Number(topicId.slice('advisor-'.length));
      return [{ lecturerId: `lecturer-${index}`, supervisorOrder: 1, firstName: `Advisor ${index}`, lastName: 'Lecturer', email: null }];
    });
    await renderThemed(<ThesisAdvisorsScreen {...baseProps} role="lecturer" />);
    await screen.findByText('Lecturer Advisor 0');

    expect(screen.getAllByText(/^Lecturer Advisor \d+$/).length).toBeLessThanOrEqual(8);
  });

  test('a forbidden supervisor read shows access denied instead of an empty directory', async () => {
    setWidth(360);
    mockApi.supervisors.mockRejectedValue(Object.assign(new Error('denied'), { status: 403 }));
    await renderThemed(<ThesisAdvisorsScreen {...baseProps} role="lecturer" />);

    expect(await screen.findByText(copy.errors.forbidden)).toBeOnTheScreen();
    expect(screen.queryByText(copy.advisorsEmpty)).toBeNull();
  });

  test('a partially failed advisor directory can retry its missing topics', async () => {
    setWidth(360);
    let firstRead = true;
    mockApi.supervisors.mockImplementation(async (topicId: string) => {
      if (topicId === 't1' && firstRead) {
        firstRead = false;
        throw Object.assign(new Error('offline'), { status: 503 });
      }
      return topicId === 't1'
        ? SUPERVISORS
        : [{ lecturerId: 'l2', supervisorOrder: 1, firstName: 'Lan', lastName: 'Võ', email: null }];
    });
    await renderThemed(<ThesisAdvisorsScreen {...baseProps} role="lecturer" />);

    expect(await screen.findByText(copy.advisorsLoadFailed)).toBeOnTheScreen();
    expect(screen.getByText('Võ Lan')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText('Phạm Nam')).toBeOnTheScreen();
    expect(screen.queryByText(copy.advisorsLoadFailed)).toBeNull();
  });

  test('a single topic and its group cap keep the singular English noun', async () => {
    setWidth(360);
    seed({ topics: [topic('t1', 'Solo topic', { maxGroups: 1 })] });
    await renderEnglish(<ThesisTopicsScreen {...baseProps} />);
    await browseAllTopics('Browse all topics in this round');
    expect(await screen.findByText('1 topic')).toBeOnTheScreen();
    expect(screen.getByText('1 thesis group')).toBeOnTheScreen();
  });

  test('a single advisor topic keeps the singular English noun', async () => {
    setWidth(360);
    seed({ topics: [TOPIC_A] });
    await renderEnglish(<ThesisTopicsScreen {...baseProps} role="lecturer" />);
    await screen.findByText('Đợt 2');
    await fireEvent.press(screen.getByRole('tab', { name: thesisMessages.en.tabAdvisors }));
    expect(await screen.findByText('1 topic')).toBeOnTheScreen();
  });

  test('the standalone round screen renders for a route registered later', async () => {
    setWidth(360);
    await renderThemed(<ThesisRoundScreen {...baseProps} />);
    expect(await screen.findByText(copy.roundRegistration)).toBeOnTheScreen();
  });

  test('a proposal round uses the web status name', async () => {
    setWidth(360);
    seed({ rounds: [round('r1', 'Đợt 1', 'PROPOSAL_OPEN')] });
    await renderThemed(<ThesisRoundScreen {...baseProps} />);
    expect((await screen.findAllByText('Giai đoạn đề tài')).length).toBeGreaterThan(0);
  });

  test('an open registration round uses the web status name', async () => {
    setWidth(360);
    seed({ rounds: [round('r2', 'Đợt 2', 'REGISTRATION_OPEN')] });
    await renderThemed(<ThesisRoundScreen {...baseProps} />);
    expect((await screen.findAllByText('Đang mở đăng ký')).length).toBeGreaterThan(0);
  });

  test('round status tones follow the web status roles', () => {
    expect(statusTone('PROPOSALS_PUBLISHED')).toBe('success');
    expect(statusTone('REGISTRATION_OPEN')).toBe('primary');
    expect(statusTone('REGISTRATION_CLOSED')).toBe('warning');
    expect(statusTone('RESULTS_PUBLISHED')).toBe('success');
    expect(statusTone('REJECTED')).toBe('error');
    expect(statusTone('CANCELLED')).toBe('error');
    expect(statusTone('PENDING')).toBe('warning');
  });

  test('the standalone advisor screen shows students the staff-only state', async () => {
    setWidth(360);
    await renderThemed(<ThesisAdvisorsScreen {...baseProps} />);
    expect(await screen.findByText('Mục này dành cho giảng viên và quản trị viên')).toBeOnTheScreen();
    expect(screen.queryByText('Phạm Nam')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Mở danh mục đề tài' }));
    expect(navigate).toHaveBeenCalledWith('thesis.topics');
  });

  test('the standalone advisor screen renders the directory for a lecturer', async () => {
    setWidth(360);
    await renderThemed(<ThesisAdvisorsScreen {...baseProps} role="lecturer" />);
    expect(await screen.findByText('Phạm Nam')).toBeOnTheScreen();
  });

  test('opening a topic passes its id to the detail route', async () => {
    setWidth(360);
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    await browseAllTopics();
    await fireEvent.press(await screen.findByRole('button', { name: `${copy.openTopic}: Trợ lý học vụ` }));
    expect(navigate).toHaveBeenCalledWith('thesis.detail', { thesisTopicId: 't1' });
  });
});

describe('topic detail', () => {
  const detail = (selected: string | null = 't1') => <ThesisDetailScreen {...baseProps} selectedThesisTopicId={selected} />;

  test('shows the brief and advisors, offers registration while open and hands the assistant a scope only', async () => {
    setWidth(360);
    await renderThemed(detail());
    expect(await screen.findByText('Mô tả Trợ lý học vụ')).toBeOnTheScreen();
    expect(await screen.findByText('Phạm Nam')).toBeOnTheScreen();
    expect(screen.getByText('Xem mô tả, số nhóm, bộ môn và trạng thái chọn.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Chọn đề tài' })).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('button', { name: copy.register }));
    expect(navigate).toHaveBeenCalledWith('thesis.registration', { thesisTopicId: 't1' });
    await fireEvent.press(screen.getByRole('button', { name: copy.askAssistantTopic }));
    expect(peekAssistantEntryScope()).toBe('specialized');
    expect(navigate).toHaveBeenCalledWith('assistant.chat');
  });

  test('assigns topic directly when the student belongs to a group with no topic yet', async () => {
    setWidth(360);
    seed({ group: group({ topicId: null }), progress: progress({ currentMilestone: 'GROUP_CREATED' }) });
    mockApi.assignTopic.mockResolvedValueOnce(group({ topicId: 't1' }));

    await renderThemed(detail());
    expect(await screen.findByRole('button', { name: copy.topicChoose })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: copy.topicChoose }));
    expect(mockApi.assignTopic).toHaveBeenCalledWith('g1', 't1');
    expect(navigate).not.toHaveBeenCalledWith('thesis.registration', expect.anything());
  });

  test('does not show a department identifier without a readable department name', async () => {
    setWidth(360);
    mockApi.topic.mockResolvedValueOnce(topic('topic-test', 'Visible topic', {
      departmentId: 'department-fit-software',
      description: 'Visible description',
    }));
    await renderThemed(detail());

    expect(await screen.findByText('Visible topic')).toBeOnTheScreen();
    expect(screen.getByText('Visible description')).toBeOnTheScreen();
    expect(screen.queryByText('department-fit-software')).toBeNull();
  });

  test('registration is not offered once the topic is already chosen', async () => {
    setWidth(360);
    seed({ group: group({ topicId: 't1' }), progress: progress() });
    await renderThemed(detail());
    await screen.findByText('Mô tả Trợ lý học vụ');
    expect(await screen.findByText(copy.topicAssigned)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.register })).toBeNull();
  });

  test('registration is not offered when the round is closed', async () => {
    setWidth(360);
    seed({ rounds: [round('r2', 'Đợt 2', 'REGISTRATION_CLOSED')] });
    await renderThemed(detail());
    await screen.findByText('Mô tả Trợ lý học vụ');
    expect(screen.queryByRole('button', { name: copy.register })).toBeNull();
  });

  test('a student without a group is told the prerequisite when choosing is unavailable', async () => {
    setWidth(360);
    seed({ rounds: [round('r2', 'Đợt 2', 'REGISTRATION_CLOSED')] });
    await renderThemed(detail());
    expect(await screen.findByText('Bạn chưa có nhóm trong đợt này.')).toBeOnTheScreen();
    expect(screen.getByText('Tạo nhóm khi đợt đăng ký mở.')).toBeOnTheScreen();
  });

  test('a student whose group was cancelled sees why the topic is not chosen', async () => {
    setWidth(360);
    seed({ group: group({ status: 'CANCELLED' }), progress: progress({ groupStatus: 'CANCELLED' }) });
    await renderThemed(detail());
    expect(await screen.findByText('Nhóm của bạn đã bị hủy và không tiếp tục trong đợt này.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.register })).toBeNull();
  });

  test('registration is not offered once the open window has passed', async () => {
    setWidth(360);
    seed({ rounds: [round('r2', 'Đợt 2', 'REGISTRATION_OPEN', { registrationEnd: '2026-09-30T23:59:59Z' })] });
    await renderThemed(detail());
    await screen.findByText('Mô tả Trợ lý học vụ');
    expect(screen.queryByRole('button', { name: copy.register })).toBeNull();
  });

  test('a failed rounds read shows a retryable error where the register action would be', async () => {
    setWidth(360);
    mockApi.rounds.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));
    await renderThemed(detail());
    expect(await screen.findByText(copy.errors.unavailable)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.register })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByRole('button', { name: copy.register })).toBeOnTheScreen();
  });

  test('registration waits for a successful group lookup and retries a failed lookup', async () => {
    setWidth(360);
    const pendingGroups = deferred<unknown>();
    mockApi.myGroups.mockReturnValueOnce(pendingGroups.promise).mockResolvedValueOnce(page([]));
    await renderThemed(detail());
    expect(await screen.findByText('Mô tả Trợ lý học vụ')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.register })).toBeNull();

    await act(async () => { pendingGroups.reject(Object.assign(new Error('timeout'), { status: 503 })); });
    expect(await screen.findByText(copy.errors.unavailable)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.register })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByRole('button', { name: copy.register })).toBeOnTheScreen();
  });

  test('a missing selection has a clear state', async () => {
    setWidth(360);
    await renderThemed(detail(null));
    expect(await screen.findByText(copy.topicNotFound)).toBeOnTheScreen();
  });

  test('an unknown topic has a clear state', async () => {
    setWidth(360);
    mockApi.topic.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    await renderThemed(detail('missing'));
    expect(await screen.findByText(copy.errors.notFound)).toBeOnTheScreen();
  });
});

describe('registration', () => {
  const screenUnderTest = (selected: string | null = null) => <ThesisRegistrationScreen {...baseProps} selectedThesisTopicId={selected} />;

  test('without a group the leader creates one while registration is open', async () => {
    setWidth(360);
    const created = group({ memberStudentIds: ['s1'], members: [member('s1', 'Nguyễn An', true)] });
    mockApi.createGroup.mockResolvedValue(created);
    mockApi.myGroups.mockResolvedValueOnce(page([])).mockResolvedValue(page([created]));
    await renderThemed(screenUnderTest());
    await fireEvent.press(await screen.findByRole('button', { name: copy.groupCreate }));
    await waitFor(() => expect(mockApi.createGroup).toHaveBeenCalledWith('r2'));
    expect(await screen.findByText(/1\/5/)).toBeOnTheScreen();
  });

  test('same-frame repeated group creation sends one request', async () => {
    setWidth(360);
    const created = group({ memberStudentIds: ['s1'], members: [member('s1', 'Nguyễn An', true)] });
    const pending = deferred<unknown>();
    mockApi.createGroup.mockReturnValue(pending.promise);
    await renderThemed(screenUnderTest());

    try {
      await pressTwiceBeforeCommit(await screen.findByRole('button', { name: copy.groupCreate }));
      expect(mockApi.createGroup).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        pending.resolve(created);
        await pending.promise;
      });
    }
  });

  test('a cancelled group leaves registration available in an open round', async () => {
    setWidth(360);
    seed({ group: group({ status: 'CANCELLED' }), progress: progress({ groupStatus: 'CANCELLED' }) });

    await renderThemed(screenUnderTest());

    expect(await screen.findByRole('button', { name: copy.groupCreate })).toBeOnTheScreen();
    expect(mockApi.createGroup).not.toHaveBeenCalled();
  });

  test('a closed round disables creation and says why', async () => {
    setWidth(360);
    seed({ rounds: [round('r2', 'Đợt 2', 'REGISTRATION_CLOSED')] });
    await renderThemed(screenUnderTest());
    expect(await screen.findByText(copy.windowClosed)).toBeOnTheScreen();
    const create = screen.getByRole('button', { name: copy.groupCreate });
    expect(create.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(create);
    expect(mockApi.createGroup).not.toHaveBeenCalled();
  });

  test('the membership rule names the exactly-one-leader requirement', async () => {
    setWidth(360);
    seed({ group: group(), progress: progress() });
    await renderThemed(screenUnderTest());
    expect(await screen.findByText('Nhóm khóa luận cần từ 3 đến 5 thành viên, với đúng một nhóm trưởng, trước khi được xét duyệt. Nhóm nháp có 1 hoặc 2 thành viên có thể tiếp tục bổ sung trước khi duyệt. (3/5)')).toBeOnTheScreen();
  });

  test('waits for the selected topic round before enabling group creation', async () => {
    setWidth(360);
    selectThesisRound('r2');
    seed({ rounds: [round('r1', 'Đợt 1', 'REGISTRATION_OPEN'), round('r2', 'Đợt 2', 'REGISTRATION_OPEN')] });
    const pendingTopic = deferred<unknown>();
    mockApi.topic.mockReturnValueOnce(pendingTopic.promise);
    mockApi.createGroup.mockResolvedValue(group({ roundId: 'r1' }));

    await renderThemed(screenUnderTest('t-old'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(screen.queryByRole('button', { name: copy.groupCreate })).toBeNull();

    await act(async () => {
      pendingTopic.resolve(topic('t-old', 'Đề tài đợt 1', { roundId: 'r1' }));
      await pendingTopic.promise;
    });
    await fireEvent.press(await screen.findByRole('button', { name: copy.groupCreate }));
    await waitFor(() => expect(mockApi.createGroup).toHaveBeenCalledWith('r1'));
  });

  test('does not use the active round when the selected topic id is empty', async () => {
    setWidth(360);
    selectThesisRound('r2');
    seed({ rounds: [round('r1', 'Đợt 1', 'REGISTRATION_OPEN'), round('r2', 'Đợt 2', 'REGISTRATION_OPEN')] });

    await renderThemed(screenUnderTest(''));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(screen.getByText(copy.topicNotFound)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.groupCreate })).toBeNull();
  });

  test('an open-status round past its window disables writes and says why', async () => {
    setWidth(360);
    seed({ rounds: [round('r2', 'Đợt 2', 'REGISTRATION_OPEN', { registrationEnd: '2026-09-30T23:59:59Z' })] });
    await renderThemed(screenUnderTest());
    expect(await screen.findByText(copy.windowClosed)).toBeOnTheScreen();
    const create = screen.getByRole('button', { name: copy.groupCreate });
    expect(create.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(create);
    expect(mockApi.createGroup).not.toHaveBeenCalled();
  });

  test('the leader finds a classmate, adds them and removes another member after confirming', async () => {
    setWidth(360);
    seed({ group: group({ memberStudentIds: ['s1', 's2', 's3'] }), progress: progress() });
    mockApi.searchStudents.mockResolvedValue([
      { studentId: 's2', studentNumber: '211', firstName: 'Bảo', lastName: 'Trần' },
      { studentId: 's4', studentNumber: '214', firstName: 'Dũng', lastName: 'Phạm' },
    ]);
    mockApi.addMember.mockResolvedValue(group({ memberStudentIds: ['s1', 's2', 's3', 's4'], members: [member('s1', 'Nguyễn An', true), member('s2', 'Trần Bảo'), member('s3', 'Lê Hà'), member('s4', 'Phạm Dũng')] }));
    mockApi.removeMember.mockResolvedValue(group({ memberStudentIds: ['s1', 's2'] }));
    await renderThemed(screenUnderTest());
    await fireEvent.changeText(await screen.findByLabelText(copy.memberSearch), 'du');
    // Existing members are filtered out of the results.
    const add = await screen.findByRole('button', { name: `${copy.memberAdd}: Phạm Dũng`, }, { timeout: 2000 });
    expect(screen.queryByRole('button', { name: `${copy.memberAdd}: Trần Bảo` })).toBeNull();
    await fireEvent.press(add);
    await waitFor(() => expect(mockApi.addMember).toHaveBeenCalledWith('g1', 's4'));

    await fireEvent.press(await screen.findByRole('button', { name: `${copy.memberRemove}: Lê Hà` }));
    expect(mockApi.removeMember).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByRole('button', { name: copy.remove }));
    await waitFor(() => expect(mockApi.removeMember).toHaveBeenCalledWith('g1', 's3'));
  });

  test('clears old student suggestions as soon as the search query changes', async () => {
    setWidth(360);
    seed({ group: group({ memberStudentIds: ['s1', 's2', 's3'] }), progress: progress() });
    const pendingSearch = deferred<unknown[]>();
    mockApi.searchStudents
      .mockResolvedValueOnce([{ studentId: 's4', studentNumber: '214', firstName: 'Dũng', lastName: 'Phạm' }])
      .mockReturnValueOnce(pendingSearch.promise);
    await renderThemed(screenUnderTest());

    const field = await screen.findByLabelText(copy.memberSearch);
    await fireEvent.changeText(field, 'du');
    const oldSuggestion = `${copy.memberAdd}: Phạm Dũng`;
    expect(await screen.findByRole('button', { name: oldSuggestion }, { timeout: 2000 })).toBeOnTheScreen();

    await fireEvent.changeText(field, 'ba');
    expect(screen.queryByRole('button', { name: oldSuggestion })).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(mockApi.searchStudents).toHaveBeenCalledTimes(2);
    await act(async () => {
      pendingSearch.resolve([]);
      await pendingSearch.promise;
    });
  });

  test('keeps a failed student search distinct from an empty result', async () => {
    setWidth(360);
    seed({ group: group({ memberStudentIds: ['s1', 's2', 's3'] }), progress: progress() });
    mockApi.searchStudents.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503 }));
    await renderThemed(screenUnderTest());

    await fireEvent.changeText(await screen.findByLabelText(copy.memberSearch), 'du');
    expect(await screen.findByText(copy.errors.unavailable, {}, { timeout: 2000 })).toBeOnTheScreen();
    expect(screen.queryByText(copy.memberSearchEmpty)).toBeNull();
  });

  test('member and search result actions take their own full-width line at large text', async () => {
    setWidth(360, 2);
    seed({ group: group({ memberStudentIds: ['s1', 's2', 's3'] }), progress: progress() });
    mockApi.searchStudents.mockResolvedValue([{ studentId: 's4', studentNumber: '214', firstName: 'Dũng', lastName: 'Phạm' }]);
    await renderThemed(screenUnderTest());
    await fireEvent.changeText(await screen.findByLabelText(copy.memberSearch), 'du');
    const remove = await screen.findByRole('button', { name: `${copy.memberRemove}: Lê Hà` });
    const add = await screen.findByRole('button', { name: `${copy.memberAdd}: Phạm Dũng` }, { timeout: 2000 });
    for (const action of [remove, add]) {
      expect(StyleSheet.flatten(action.props.style).alignSelf).toBe('stretch');
      expect(StyleSheet.flatten(action.props.style).minHeight).toBeGreaterThanOrEqual(tokens.layout.touchTarget);
    }
    expect(screen.getByText('Lê Hà').props.numberOfLines).toBeUndefined();
  });

  test('member actions stay in the row at the default text scale', async () => {
    setWidth(360, 1);
    seed({ group: group({ memberStudentIds: ['s1', 's2', 's3'] }), progress: progress() });
    await renderThemed(screenUnderTest());
    const remove = await screen.findByRole('button', { name: `${copy.memberRemove}: Lê Hà` });
    expect(StyleSheet.flatten(remove.props.style).alignSelf).toBeUndefined();
  });

  test('a server rule violation shows the specific copy, never the raw message', async () => {
    setWidth(360);
    seed({ group: group({ memberStudentIds: ['s1', 's2', 's3'] }), progress: progress() });
    mockApi.searchStudents.mockResolvedValue([{ studentId: 's9', studentNumber: '219', firstName: 'Khoa', lastName: 'Đỗ' }]);
    mockApi.addMember.mockRejectedValue(Object.assign(new Error('internal stack detail'), { status: 409, code: 'STUDENT_ACTIVE_IN_OTHER_GROUP' }));
    await renderThemed(screenUnderTest());
    await fireEvent.changeText(await screen.findByLabelText(copy.memberSearch), 'khoa');
    await fireEvent.press(await screen.findByRole('button', { name: `${copy.memberAdd}: Đỗ Khoa` }, { timeout: 2000 }));
    expect(await screen.findByText(copy.errors.codes.STUDENT_ACTIVE_IN_OTHER_GROUP)).toBeOnTheScreen();
    expect(screen.queryByText(/internal stack detail/)).toBeNull();
  });

  test('a member who is not the leader sees no write controls', async () => {
    setWidth(360);
    seed({ group: group({ leaderStudentId: 's2' }), progress: progress() });
    await renderThemed(screenUnderTest());
    expect(await screen.findByText(copy.leaderOnly)).toBeOnTheScreen();
    expect(screen.queryByLabelText(copy.memberSearch)).toBeNull();
    expect(screen.queryByRole('button', { name: `${copy.memberRemove}: Lê Hà` })).toBeNull();
  });

  test('the chosen topic is confirmed against the group and shown as selected', async () => {
    setWidth(360);
    seed({ group: group(), progress: progress() });
    mockApi.assignTopic.mockResolvedValue(group({ topicId: 't1', status: 'ASSIGNED' }));
    await renderThemed(screenUnderTest('t1'));
    await fireEvent.press(await screen.findByRole('button', { name: copy.topicAssign }));
    await waitFor(() => expect(mockApi.assignTopic).toHaveBeenCalledWith('g1', 't1'));
  });
});

describe('progress and report', () => {
  const reportWindowGuidance = 'Chỉ có thể cập nhật báo cáo khi đợt đã đóng đăng ký và còn hạn nộp.';
  const closedRounds = [ROUNDS[0], round('r2', 'Đợt 2', 'REGISTRATION_CLOSED')];
  const approvedGroup = (over: Record<string, unknown> = {}) => group({ topicId: 't1', status: 'APPROVED', approvalStatus: 'APPROVED', ...over });
  const approvedProgress = progress({
    currentMilestone: 'REPORT_SUBMITTED',
    completedMilestones: ['ROUND_SELECTED', 'GROUP_CREATED', 'TOPIC_ASSIGNED', 'GROUP_APPROVED'],
    topicTitle: 'Trợ lý học vụ',
  });
  const notQualifiedProgress = progress({
    roundStatus: 'RESULTS_PUBLISHED',
    groupStatus: 'SUBMITTED',
    approvalStatus: 'APPROVED',
    currentMilestone: 'RESULTS_PUBLISHED',
    completedMilestones: ['ROUND_SELECTED', 'GROUP_CREATED', 'TOPIC_ASSIGNED', 'GROUP_APPROVED', 'REPORT_SUBMITTED', 'RESULTS_PUBLISHED'],
    skippedMilestones: ['COUNCIL_ASSIGNED', 'SCORE_FINALIZED'],
    attentionState: 'NOT_QUALIFIED',
    topicTitle: 'Trợ lý học vụ',
    resultStatus: 'NOT_QUALIFIED',
    resultReason: 'GVPB_BELOW_THRESHOLD',
    resultResolvedAt: '2026-10-20T08:00:00Z',
    finalScore: null,
  });

  test('progress screen header and group section use the web catalogue', async () => {
    setWidth(360);
    seed({ group: approvedGroup(), progress: approvedProgress });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText('Tiến độ luận văn')).toBeOnTheScreen();
    expect(screen.queryByText('Theo dõi các mốc có bằng chứng của đợt đã chọn.')).toBeNull();
    expect(screen.getByText('Khu nhóm của bạn')).toBeOnTheScreen();
    expect(screen.getAllByText(ROUNDS[1].name).length).toBeGreaterThan(0);
  });

  test('without a group the student is invited to register', async () => {
    setWidth(360);
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    await fireEvent.press(await screen.findByRole('button', { name: copy.startRegistration }));
    expect(navigate).toHaveBeenCalledWith('thesis.registration');
  });

  test('shows server milestones, the attention message and the assistant entry', async () => {
    setWidth(360);
    seed({
      group: group({ status: 'REJECTED', approvalStatus: 'REJECTED', rejectionReason: 'Thiếu thành viên' }),
      progress: progress({ attentionState: 'GROUP_REJECTED' }),
    });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText(copy.attention.GROUP_REJECTED)).toBeOnTheScreen();
    expect(screen.getByText(`${copy.groupRejectedReason}: Thiếu thành viên`)).toBeOnTheScreen();
    expect(screen.getByText(copy.milestones.GROUP_CREATED)).toBeOnTheScreen();
    expect(screen.getByText(copy.milestoneCurrent)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: copy.askAssistant }));
    expect(peekAssistantEntryScope()).toBe('specialized');
    expect(navigate).toHaveBeenCalledWith('assistant.chat');
  });

  test('milestone labels are the web catalogue labels', async () => {
    setWidth(360);
    seed({ group: approvedGroup(), progress: approvedProgress });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    for (const label of [
      'Đã chọn đợt',
      'Đã tạo nhóm',
      'Đã được gán đề tài',
      'Nhóm đã được duyệt',
      'Đã nộp báo cáo',
      'Đã phân công hội đồng',
      'Đã chốt điểm',
      'Đã công bố kết quả',
    ]) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    expect(screen.getAllByText('Đã xong').length).toBeGreaterThan(0);
  });

  test('the progress header names the current stage and the attention heading', async () => {
    setWidth(360);
    seed({
      group: group({ status: 'REJECTED', approvalStatus: 'REJECTED' }),
      progress: progress({ attentionState: 'GROUP_REJECTED' }),
    });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText('Giai đoạn hiện tại: Đã được gán đề tài')).toBeOnTheScreen();
    expect(screen.getByText('Cần lưu ý')).toBeOnTheScreen();
  });

  test('a rejected group never renders a stale final score', async () => {
    setWidth(360);
    seed({
      group: group({ status: 'REJECTED', approvalStatus: 'REJECTED' }),
      progress: progress({
        attentionState: 'GROUP_REJECTED',
        approvalStatus: 'REJECTED',
        groupStatus: 'REJECTED',
        finalScore: 8.25,
      }),
    });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText(copy.attention.GROUP_REJECTED)).toBeOnTheScreen();
    expect(screen.queryByText(new RegExp(`^${copy.finalScore}:`))).toBeNull();
  });

  test('a submitted group rejected by a lecturer shows the rejection badge', async () => {
    setWidth(360);
    seed({ group: group({ status: 'SUBMITTED', approvalStatus: 'REJECTED', rejectionReason: 'Thiếu thành viên' }), progress: progress() });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);

    await screen.findByText(`${copy.groupRejectedReason}: Thiếu thành viên`);
    expect(screen.getAllByText(copy.status.REJECTED)).toHaveLength(2);
    expect(screen.queryByText(copy.status.SUBMITTED)).toBeNull();
  });

  test('member IDs remain visible when the group has no hydrated member rows', async () => {
    setWidth(360);
    seed({ group: group({ memberStudentIds: ['s1', 's2'], members: [] }), progress: progress() });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);

    expect(await screen.findByText('s1')).toBeOnTheScreen();
    expect(screen.getByText('s2')).toBeOnTheScreen();
  });

  test('an approved group renders the published final score', async () => {
    setWidth(360);
    seed({
      group: approvedGroup(),
      progress: { ...approvedProgress, finalScore: 8.25 },
    });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText(new RegExp(`^${copy.finalScore}:`))).toBeOnTheScreen();
  });

  test('a not-qualified result shows the outcome, skipped steps and no score', async () => {
    setWidth(360);
    seed({ group: approvedGroup(), progress: notQualifiedProgress });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    const outcome = 'Không đủ điều kiện bảo vệ - điểm phản biện dưới 5,0';
    const outcomeText = await screen.findByText(outcome);
    expect(outcomeText).toBeOnTheScreen();
    expect(outcomeText.props.accessibilityRole).toBe('alert');
    expect(screen.getAllByText('Không áp dụng')).toHaveLength(2);
    expect(screen.getByLabelText('Đã phân công hội đồng: Không áp dụng')).toBeOnTheScreen();
    expect(screen.getByLabelText('Đã chốt điểm: Không áp dụng')).toBeOnTheScreen();
    expect(screen.queryByText(new RegExp(`^${copy.finalScore}:`))).toBeNull();
    expect(screen.queryByText(/^0([.,]0+)?$/)).toBeNull();
    expect(screen.queryByText(copy.attention.RESULT_NOT_AVAILABLE)).toBeNull();
    expect(screen.queryByText(copy.attention.PROGRESS_INCONSISTENT)).toBeNull();
  });

  test('the not-qualified outcome and skipped label are localised', async () => {
    setWidth(360);
    seed({ group: approvedGroup(), progress: notQualifiedProgress });
    await renderEnglish(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText('Not eligible for defense - counter-review score below 5.0')).toBeOnTheScreen();
    expect(screen.getAllByText('Not applicable')).toHaveLength(2);
  });

  test('a graded result keeps every step and its score', async () => {
    setWidth(360);
    seed({
      group: approvedGroup(),
      progress: {
        ...approvedProgress,
        roundStatus: 'RESULTS_PUBLISHED',
        groupStatus: 'SUBMITTED',
        approvalStatus: 'APPROVED',
        currentMilestone: 'RESULTS_PUBLISHED',
        completedMilestones: ['ROUND_SELECTED', 'GROUP_CREATED', 'TOPIC_ASSIGNED', 'GROUP_APPROVED', 'REPORT_SUBMITTED', 'COUNCIL_ASSIGNED', 'SCORE_FINALIZED', 'RESULTS_PUBLISHED'],
        skippedMilestones: [],
        resultStatus: 'GRADED',
        finalScore: 8.25,
      },
    });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText(new RegExp(`^${copy.finalScore}:`))).toBeOnTheScreen();
    expect(screen.queryByText('Không áp dụng')).toBeNull();
  });

  test('a null final score is never rendered as zero', async () => {
    setWidth(360);
    seed({
      group: approvedGroup(),
      progress: progress({
        roundStatus: 'RESULTS_PUBLISHED',
        groupStatus: 'SUBMITTED',
        approvalStatus: 'APPROVED',
        currentMilestone: 'RESULTS_PUBLISHED',
        completedMilestones: ['ROUND_SELECTED', 'GROUP_CREATED', 'TOPIC_ASSIGNED', 'GROUP_APPROVED', 'REPORT_SUBMITTED'],
        finalScore: null,
      }),
    });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    await screen.findByRole('progressbar');
    expect(screen.queryByText(new RegExp(`^${copy.finalScore}:`))).toBeNull();
    expect(screen.queryByText(/^0([.,]0+)?$/)).toBeNull();
  });

  test('a graded zero is a real score', async () => {
    setWidth(360);
    seed({
      group: approvedGroup(),
      progress: {
        ...approvedProgress,
        roundStatus: 'RESULTS_PUBLISHED',
        groupStatus: 'SUBMITTED',
        approvalStatus: 'APPROVED',
        currentMilestone: 'RESULTS_PUBLISHED',
        completedMilestones: ['ROUND_SELECTED', 'GROUP_CREATED', 'TOPIC_ASSIGNED', 'GROUP_APPROVED', 'REPORT_SUBMITTED', 'COUNCIL_ASSIGNED', 'SCORE_FINALIZED', 'RESULTS_PUBLISHED'],
        skippedMilestones: [],
        resultStatus: 'GRADED',
        finalScore: 0,
      },
    });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText(`${copy.finalScore}: 0`)).toBeOnTheScreen();
  });

  test('the progress bar is announced with the Vietnamese progress label', async () => {
    setWidth(360);
    seed({ group: approvedGroup(), progress: approvedProgress });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect((await screen.findByRole('progressbar')).props.accessibilityLabel).toBe('Tiến độ');
  });

  test('a single group member keeps the singular English noun', async () => {
    setWidth(360);
    seed({
      group: group({ memberStudentIds: ['s1'], members: [member('s1', 'Nguyễn An', true)] }),
      progress: progress({ groupId: 'g1' }),
    });
    await renderEnglish(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText('1 member')).toBeOnTheScreen();
  });

  test('the report is locked until the group is approved', async () => {
    setWidth(360);
    seed({ group: group(), progress: progress() });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText(copy.reportNeedsApproval)).toBeOnTheScreen();
    expect(mockApi.report).not.toHaveBeenCalled();
  });

  test('report writes wait for registration to close and show window guidance', async () => {
    setWidth(360);
    seed({ group: approvedGroup(), progress: approvedProgress });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);

    expect(await screen.findByText(reportWindowGuidance)).toBeOnTheScreen();
    expect(screen.queryByLabelText(copy.reportTitle)).toBeNull();
    expect(screen.queryByRole('button', { name: copy.reportSubmit })).toBeNull();
  });

  test('report writes are locked after the deadline and the date is shown', async () => {
    setWidth(360);
    seed({
      rounds: [ROUNDS[0], round('r2', 'Đợt 2', 'REGISTRATION_CLOSED', { reportDeadline: '2026-09-30T23:59:59Z' })],
      group: approvedGroup(),
      progress: approvedProgress,
    });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);

    expect(await screen.findByText(reportWindowGuidance)).toBeOnTheScreen();
    expect(screen.getByText(new RegExp(copy.reportDeadline))).toBeOnTheScreen();
    expect(screen.queryByLabelText(copy.reportTitle)).toBeNull();
  });

  test('a link report needs an artifact and an http(s) link before anything is sent', async () => {
    setWidth(360);
    seed({ rounds: closedRounds, group: approvedGroup(), progress: approvedProgress });
    mockApi.submitReportLink.mockResolvedValue({ groupId: 'g1', title: 'Báo cáo', url: 'https://example.edu/r', submittedAt: '2026-10-01T08:00:00Z' });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    const submit = await screen.findByRole('button', { name: copy.reportSubmit });
    await fireEvent.press(submit);
    expect(await screen.findByText(copy.validation.artifactRequired)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(copy.reportUrl), 'ftp://example.edu/r');
    await fireEvent.press(screen.getByRole('button', { name: copy.reportSubmit }));
    expect(await screen.findByText(copy.validation.urlInvalid)).toBeOnTheScreen();
    expect(mockApi.submitReportLink).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText(copy.reportTitle), 'Báo cáo');
    await fireEvent.changeText(screen.getByLabelText(copy.reportUrl), 'https://example.edu/r');
    await fireEvent.press(screen.getByRole('button', { name: copy.reportSubmit }));
    await waitFor(() => expect(mockApi.submitReportLink).toHaveBeenCalledWith('g1', { url: 'https://example.edu/r', title: 'Báo cáo', note: undefined }));
    const submitted = await screen.findAllByText(copy.reportSubmitted);
    expect(submitted.some((node) => node.props.accessibilityRole === 'alert')).toBe(true);
  });

  test('same-frame repeated report submission sends one request', async () => {
    setWidth(360);
    seed({ rounds: closedRounds, group: approvedGroup(), progress: approvedProgress });
    const pending = deferred<unknown>();
    mockApi.submitReportLink.mockReturnValue(pending.promise);
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    await fireEvent.changeText(await screen.findByLabelText(copy.reportTitle), 'Báo cáo');
    await fireEvent.changeText(screen.getByLabelText(copy.reportUrl), 'https://example.edu/r');

    try {
      await pressTwiceBeforeCommit(screen.getByRole('button', { name: copy.reportSubmit }));
      expect(mockApi.submitReportLink).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        pending.resolve({ groupId: 'g1', title: 'Báo cáo', url: 'https://example.edu/r' });
        await pending.promise;
      });
    }
  });

  test('the report form waits for the first read before it can be edited', async () => {
    setWidth(360);
    seed({ rounds: closedRounds, group: approvedGroup(), progress: approvedProgress });
    const pending = deferred<unknown>();
    mockApi.report.mockReset();
    mockApi.report.mockImplementation(() => pending.promise);
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText(copy.report)).toBeOnTheScreen();
    expect(screen.queryByLabelText(copy.reportTitle)).toBeNull();
    await act(async () => { pending.resolve({ groupId: 'g1', title: 'Báo cáo cũ' }); });
    await waitFor(() => expect(screen.getByLabelText(copy.reportTitle)).toBeOnTheScreen());
    expect(screen.getByLabelText(copy.reportTitle).props.value).toBe('Báo cáo cũ');
  });

  test('the report deadline is shown while the closed-round write window is open', async () => {
    setWidth(360);
    seed({
      rounds: [ROUNDS[0], round('r2', 'Đợt 2', 'REGISTRATION_CLOSED', { reportDeadline: '2099-12-31T23:59:59Z' })],
      group: approvedGroup(),
      progress: approvedProgress,
    });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);

    expect(await screen.findByRole('button', { name: copy.reportSubmit })).toBeOnTheScreen();
    expect(screen.getByText(new RegExp(copy.reportDeadline))).toBeOnTheScreen();
  });

  test('without a file adapter the picker is unavailable and the link path stays usable', async () => {
    setWidth(360);
    seed({ rounds: closedRounds, group: approvedGroup(), progress: approvedProgress });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText(copy.reportFileUnavailable)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.reportPick })).toBeNull();
    expect(screen.getByLabelText(copy.reportUrl)).toBeOnTheScreen();
  });

  test('does not start a second report picker while the first one is pending', async () => {
    setWidth(360);
    seed({ rounds: closedRounds, group: approvedGroup(), progress: approvedProgress });
    const pendingPick = deferred<{ status: 'cancelled' }>();
    const pick = jest.fn(() => pendingPick.promise);
    setFileAdapter({
      ...createUnavailableFileAdapter(),
      capability: () => ({ available: true }),
      pick,
    });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);

    await fireEvent.press(await screen.findByRole('button', { name: copy.reportPick }));
    await fireEvent.press(await screen.findByRole('button', { name: copy.reportPick }));
    expect(pick).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingPick.resolve({ status: 'cancelled' });
      await pendingPick.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('button', { name: copy.reportPick }).props.accessibilityState?.busy).toBe(false);
  });

  test('a picked file uploads as a multipart part and can be cancelled', async () => {
    setWidth(360);
    seed({ rounds: closedRounds, group: approvedGroup(), progress: approvedProgress });
    const adapter: FileAdapter = {
      ...createUnavailableFileAdapter(),
      capability: () => ({ available: true }),
      pick: async () => ({ status: 'picked', file: { uri: 'file:///a/bao-cao.pdf', name: 'bao-cao.pdf', sizeBytes: 4096 } }),
    };
    setFileAdapter(adapter);
    let seenSignal: AbortSignal | undefined;
    mockApi.submitReportFile.mockImplementation((_group: string, _input: unknown, options?: { signal?: AbortSignal }) => {
      seenSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'REQUEST_ABORTED', status: 0 })));
      });
    });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    await fireEvent.press(await screen.findByRole('button', { name: copy.reportPick }));
    expect(await screen.findByText(new RegExp(`${copy.reportPicked}: bao-cao.pdf`))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: copy.reportSubmit }));
    await waitFor(() => expect(mockApi.submitReportFile).toHaveBeenCalled());
    expect(mockApi.submitReportFile.mock.calls[0][1]).toEqual({
      file: { uri: 'file:///a/bao-cao.pdf', name: 'bao-cao.pdf', type: 'application/pdf' },
      title: undefined,
      note: undefined,
    });
    await fireEvent.press(await screen.findByRole('button', { name: copy.reportUploadCancel }));
    await waitFor(() => expect(seenSignal?.aborted).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: copy.reportUploadCancel })).toBeNull());
    expect(screen.queryByText(copy.errors.generic)).toBeNull();
  });

  test('the picked file cache copy is released on replace, upload and unmount', async () => {
    setWidth(360);
    seed({ rounds: closedRounds, group: approvedGroup(), progress: approvedProgress });
    const released: string[] = [];
    const pickedFile = (name: string) => ({
      uri: `file:///a/${name}`, name, sizeBytes: 2048,
      release: () => { released.push(name); },
    });
    const queue = [pickedFile('first.pdf'), pickedFile('second.pdf'), pickedFile('third.pdf')];
    setFileAdapter({
      ...createUnavailableFileAdapter(),
      capability: () => ({ available: true }),
      pick: async () => ({ status: 'picked', file: queue.shift()! }),
    });
    mockApi.submitReportFile.mockResolvedValue({ groupId: 'g1', title: 'Báo cáo', fileName: 'second.pdf' });
    const utils = await renderThemed(<ThesisProgressScreen {...baseProps} />);

    await fireEvent.press(await screen.findByRole('button', { name: copy.reportPick }));
    await screen.findByText(/first\.pdf/);
    await fireEvent.press(screen.getByRole('button', { name: copy.reportPick }));
    await screen.findByText(/second\.pdf/);
    expect(released).toEqual(['first.pdf']);

    await fireEvent.press(screen.getByRole('button', { name: copy.reportSubmit }));
    await waitFor(() => expect(mockApi.submitReportFile).toHaveBeenCalled());
    await waitFor(() => expect(released).toEqual(['first.pdf', 'second.pdf']));

    await fireEvent.press(screen.getByRole('button', { name: copy.reportPick }));
    await screen.findByText(/third\.pdf/);
    utils.unmount();
    await waitFor(() => expect(released).toEqual(['first.pdf', 'second.pdf', 'third.pdf']));
  });

  test('a stored file can be downloaded through the save sheet and removed only after confirmation', async () => {
    setWidth(360);
    seed({ rounds: closedRounds, group: approvedGroup(), progress: approvedProgress });
    mockApi.report.mockReset();
    mockApi.report.mockResolvedValue({ groupId: 'g1', title: 'Báo cáo', url: 'https://example.edu/r', fileName: 'bao-cao.pdf', fileSize: 2048, submittedAt: '2026-10-01T08:00:00Z' });
    const saved: unknown[] = [];
    setFileAdapter({
      ...createUnavailableFileAdapter(),
      capability: () => ({ available: true }),
      save: async (target) => { saved.push(target); return { status: 'done' }; },
    });
    mockApi.downloadReportFile.mockResolvedValue({ data: new TextEncoder().encode('%PDF').buffer, contentType: 'application/pdf', fileName: 'bao-cao.pdf' });
    mockApi.removeReportFile.mockResolvedValue({ groupId: 'g1', title: 'Báo cáo', url: 'https://example.edu/r' });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    await fireEvent.press(await screen.findByRole('button', { name: copy.reportDownload }));
    expect(await screen.findByText(copy.reportFileSaved)).toBeOnTheScreen();
    expect(saved).toHaveLength(1);

    await fireEvent.press(screen.getByRole('button', { name: copy.reportRemoveFile }));
    expect(mockApi.removeReportFile).not.toHaveBeenCalled();
    // The confirmation dialog renders after the card, so its confirm button is the last match.
    const confirm = (await screen.findAllByRole('button', { name: copy.reportRemoveFile })).at(-1)!;
    await fireEvent.press(confirm);
    await waitFor(() => expect(mockApi.removeReportFile).toHaveBeenCalledWith('g1'));
  });

  test('a file-only report does not offer removal without a link artifact', async () => {
    setWidth(360);
    seed({
      rounds: [ROUNDS[0], round('r2', 'Đợt 2', 'REGISTRATION_CLOSED')],
      group: approvedGroup(),
      progress: approvedProgress,
    });
    mockApi.report.mockReset();
    mockApi.report.mockResolvedValue({ groupId: 'g1', title: 'Báo cáo', fileName: 'bao-cao.pdf' });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);

    expect(await screen.findByText('bao-cao.pdf')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.reportRemoveFile })).toBeNull();
  });

  test('same-frame repeated report removal confirmation sends one request', async () => {
    setWidth(360);
    seed({ rounds: closedRounds, group: approvedGroup(), progress: approvedProgress });
    mockApi.report.mockReset();
    mockApi.report.mockResolvedValue({ groupId: 'g1', title: 'Báo cáo', url: 'https://example.edu/r', fileName: 'bao-cao.pdf' });
    const pending = deferred<unknown>();
    mockApi.removeReportFile.mockReturnValue(pending.promise);
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    await fireEvent.press(await screen.findByRole('button', { name: copy.reportRemoveFile }));

    const confirm = (await screen.findAllByRole('button', { name: copy.reportRemoveFile })).at(-1)!;
    try {
      await pressTwiceBeforeCommit(confirm);
      expect(mockApi.removeReportFile).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        pending.resolve({ groupId: 'g1', title: 'Báo cáo' });
        await pending.promise;
      });
    }
  });

  test('a member sees the report read-only', async () => {
    setWidth(360);
    seed({ group: approvedGroup({ leaderStudentId: 's2' }), progress: approvedProgress });
    mockApi.report.mockReset();
    mockApi.report.mockResolvedValue({ groupId: 'g1', title: 'Báo cáo nhóm', url: 'https://example.edu/r' });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText('Báo cáo nhóm')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.reportSubmit })).toBeNull();
    expect(screen.queryByLabelText(copy.reportTitle)).toBeNull();
  });

  test('a failed report save keeps the typed title, note and link', async () => {
    setWidth(360);
    seed({ rounds: closedRounds, group: approvedGroup(), progress: approvedProgress });
    mockApi.report.mockReset();
    // A reload returns a new object carrying the unchanged stored values.
    mockApi.report.mockImplementation(async () => ({ groupId: 'g1', title: 'Báo cáo cũ', url: 'https://example.edu/cu' }));
    mockApi.updateReport.mockRejectedValue(Object.assign(new Error('boom'), { status: 503 }));
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    await fireEvent.changeText(await screen.findByLabelText(copy.reportTitle), 'Tiêu đề mới');
    await fireEvent.changeText(screen.getByLabelText(copy.reportNote), 'Ghi chú mới');
    await fireEvent.changeText(screen.getByLabelText(copy.reportUrl), 'https://example.edu/moi');
    await fireEvent.press(screen.getByRole('button', { name: copy.reportUpdate }));
    expect(await screen.findByText(copy.errors.unavailable)).toBeOnTheScreen();
    await waitFor(() => expect(mockApi.report).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText(copy.reportTitle).props.value).toBe('Tiêu đề mới');
    expect(screen.getByLabelText(copy.reportNote).props.value).toBe('Ghi chú mới');
    expect(screen.getByLabelText(copy.reportUrl).props.value).toBe('https://example.edu/moi');
  });

  test('a failed progress read shows a retryable error instead of a 0% progress card', async () => {
    setWidth(360);
    seed({ group: approvedGroup() });
    mockApi.progress.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText('Không tải được tiến độ.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.retry })).toBeOnTheScreen();
    expect(screen.queryByText('0%')).toBeNull();
    // The group read is independent of the progress read and stays on screen.
    expect(screen.getByText('Nguyễn An')).toBeOnTheScreen();
    expect(mockApi.progress).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
    await waitFor(() => expect(mockApi.progress).toHaveBeenCalledTimes(2));
  });
});

describe('preview mode', () => {
  test('serves sample topics and says so without calling the network', async () => {
    setWidth(360);
    mockClient.mode = 'preview';
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    expect(screen.queryByText(copy.previewNotice)).toBeNull();
    await browseAllTopics();
    expect(screen.getByText('Trợ lý học vụ có kiểm chứng nguồn')).toBeOnTheScreen();
    for (const fn of Object.values(mockApi)) expect(fn).not.toHaveBeenCalled();
  });

  test('registration is read-only in preview', async () => {
    setWidth(360);
    mockClient.mode = 'preview';
    await renderThemed(<ThesisRegistrationScreen {...baseProps} selectedThesisTopicId="preview-topic-1" />);
    expect(screen.queryByText(copy.previewNotice)).toBeNull();
    expect(screen.queryByLabelText(copy.memberSearch)).toBeNull();
    for (const fn of Object.values(mockApi)) expect(fn).not.toHaveBeenCalled();
  });
});

test('a picked file that resolves after unmount releases its cache copy', async () => {
  setWidth(360);
  seed({ rounds: [ROUNDS[0], round('r2', 'Đợt 2', 'REGISTRATION_CLOSED')], group: group({ topicId: 't1', status: 'APPROVED', approvalStatus: 'APPROVED' }), progress: progress() });
  const pending = deferred<{ status: 'picked'; file: { uri: string; name: string; sizeBytes: number; release: () => void } }>();
  const release = jest.fn();
  const adapter: FileAdapter = {
    ...createUnavailableFileAdapter(),
    capability: () => ({ available: true }),
    pick: () => pending.promise,
  };
  setFileAdapter(adapter);
  const utils = await renderThemed(<ThesisProgressScreen {...baseProps} />);

  await fireEvent.press(await screen.findByRole('button', { name: copy.reportPick }));
  utils.unmount();
  await act(async () => {
    pending.resolve({
      status: 'picked',
      file: { uri: 'file:///a/report.pdf', name: 'report.pdf', sizeBytes: 2048, release },
    });
    await pending.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(release).toHaveBeenCalledTimes(1);
});
