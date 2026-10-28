import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';

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
import { thesisMessages } from '../../src/i18n/thesis-messages';
import type { MobileScreenProps } from '../../src/navigation/types';
import { selectThesisRound } from '../../src/screens/thesis/thesis-selection';
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
function setWidth(w: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: w, height: 800, scale: 2, fontScale: 1 } as ReturnType<typeof Dimensions.get>);
}

const round = (id: string, name: string, status: string) => ({
  id, name, status,
  registrationStart: '2026-08-25T00:00:00Z',
  registrationEnd: '2026-09-30T23:59:59Z',
  thesisType: 'KLTN',
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
  test('opens on the registration round and lists its published topics', async () => {
    setWidth(360);
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    expect(await screen.findByText('Trợ lý học vụ')).toBeOnTheScreen();
    expect(screen.getByText('Thư viện di động')).toBeOnTheScreen();
    expect(mockApi.topics).toHaveBeenCalledWith('r2', { page: 0, limit: 20 });
    expect(screen.getByText('Đợt 2')).toBeOnTheScreen();
  });

  test('search ignores accents and narrows the loaded topics', async () => {
    setWidth(360);
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    await screen.findByText('Trợ lý học vụ');
    await fireEvent.changeText(screen.getByLabelText(copy.searchLabel), 'thu vien');
    expect(screen.queryByText('Trợ lý học vụ')).toBeNull();
    expect(screen.getByText('Thư viện di động')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(copy.searchLabel), 'khong co');
    expect(await screen.findByText(copy.emptyTopicsFiltered)).toBeOnTheScreen();
  });

  test('a long list pages in on request and appends without duplicates', async () => {
    setWidth(360);
    mockApi.topics.mockResolvedValueOnce(page([TOPIC_A, TOPIC_B], true, 3)).mockResolvedValueOnce(page([TOPIC_B, TOPIC_C], false, 3));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
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
    expect(await screen.findByText(copy.emptyTopics)).toBeOnTheScreen();
  });

  test('a failed read shows student-safe copy and recovers on retry', async () => {
    setWidth(360);
    mockApi.topics.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 })).mockResolvedValueOnce(page([TOPIC_A]));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    expect(await screen.findByText(copy.errors.unavailable)).toBeOnTheScreen();
    expect(screen.queryByText('boom')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText('Trợ lý học vụ')).toBeOnTheScreen();
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
    await screen.findByText('Trợ lý học vụ');
    await fireEvent.press(screen.getByRole('button', { name: copy.roundChange }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Đợt 1,/ }));
    expect(await screen.findByText('Đề tài cũ')).toBeOnTheScreen();
    expect(screen.queryByText('Trợ lý học vụ')).toBeNull();
    expect(mockApi.topics).toHaveBeenCalledWith('r1', { page: 0, limit: 20 });
  });

  test('the round view shows the dates and the advisor view groups lecturers across topics', async () => {
    setWidth(360);
    mockApi.supervisors.mockImplementation(async (topicId: string) => (
      topicId === 't1' ? SUPERVISORS : [...SUPERVISORS, { lecturerId: 'l2', supervisorOrder: 2, firstName: 'Lan', lastName: 'Võ', email: null }]
    ));
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    await screen.findByText('Trợ lý học vụ');
    await fireEvent.press(screen.getByRole('tab', { name: copy.tabRound }));
    expect(await screen.findByText(copy.roundRegistration)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: copy.tabAdvisors }));
    expect(await screen.findByText('Phạm Nam')).toBeOnTheScreen();
    expect(screen.getByText('Võ Lan')).toBeOnTheScreen();
    expect(screen.getByText('2 đề tài')).toBeOnTheScreen();
  });

  test('the standalone round screen renders for a route registered later', async () => {
    setWidth(360);
    await renderThemed(<ThesisRoundScreen {...baseProps} />);
    expect(await screen.findByText(copy.roundRegistration)).toBeOnTheScreen();
  });

  test('the standalone advisor screen renders for a route registered later', async () => {
    setWidth(360);
    await renderThemed(<ThesisAdvisorsScreen {...baseProps} />);
    expect(await screen.findByText('Phạm Nam')).toBeOnTheScreen();
  });

  test('opening a topic passes its id to the detail route', async () => {
    setWidth(360);
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
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
    await fireEvent.press(await screen.findByRole('button', { name: copy.register }));
    expect(navigate).toHaveBeenCalledWith('thesis.registration', { thesisTopicId: 't1' });
    await fireEvent.press(screen.getByRole('button', { name: copy.askAssistantTopic }));
    expect(peekAssistantEntryScope()).toBe('specialized');
    expect(navigate).toHaveBeenCalledWith('assistant.chat');
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
  const approvedGroup = (over: Record<string, unknown> = {}) => group({ topicId: 't1', status: 'APPROVED', approvalStatus: 'APPROVED', ...over });
  const approvedProgress = progress({
    currentMilestone: 'REPORT_SUBMITTED',
    completedMilestones: ['ROUND_SELECTED', 'GROUP_CREATED', 'TOPIC_ASSIGNED', 'GROUP_APPROVED'],
    topicTitle: 'Trợ lý học vụ',
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

  test('the report is locked until the group is approved', async () => {
    setWidth(360);
    seed({ group: group(), progress: progress() });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText(copy.reportNeedsApproval)).toBeOnTheScreen();
    expect(mockApi.report).not.toHaveBeenCalled();
  });

  test('a link report needs an artifact and an http(s) link before anything is sent', async () => {
    setWidth(360);
    seed({ group: approvedGroup(), progress: approvedProgress });
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
    expect(await screen.findByText(copy.reportSubmitted)).toBeOnTheScreen();
  });

  test('without a file adapter the picker is unavailable and the link path stays usable', async () => {
    setWidth(360);
    seed({ group: approvedGroup(), progress: approvedProgress });
    await renderThemed(<ThesisProgressScreen {...baseProps} />);
    expect(await screen.findByText(copy.reportFileUnavailable)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.reportPick })).toBeNull();
    expect(screen.getByLabelText(copy.reportUrl)).toBeOnTheScreen();
  });

  test('a picked file uploads as a multipart part and can be cancelled', async () => {
    setWidth(360);
    seed({ group: approvedGroup(), progress: approvedProgress });
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

  test('a stored file can be downloaded through the save sheet and removed only after confirmation', async () => {
    setWidth(360);
    seed({ group: approvedGroup(), progress: approvedProgress });
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
});

describe('preview mode', () => {
  test('serves sample topics and says so without calling the network', async () => {
    setWidth(360);
    mockClient.mode = 'preview';
    await renderThemed(<ThesisTopicsScreen {...baseProps} />);
    expect(await screen.findByText(copy.previewNotice)).toBeOnTheScreen();
    expect(screen.getByText('Trợ lý học vụ có kiểm chứng nguồn')).toBeOnTheScreen();
    for (const fn of Object.values(mockApi)) expect(fn).not.toHaveBeenCalled();
  });

  test('registration is read-only in preview', async () => {
    setWidth(360);
    mockClient.mode = 'preview';
    await renderThemed(<ThesisRegistrationScreen {...baseProps} selectedThesisTopicId="preview-topic-1" />);
    expect(await screen.findByText(copy.previewNotice)).toBeOnTheScreen();
    expect(screen.queryByLabelText(copy.memberSearch)).toBeNull();
    for (const fn of Object.values(mockApi)) expect(fn).not.toHaveBeenCalled();
  });
});
