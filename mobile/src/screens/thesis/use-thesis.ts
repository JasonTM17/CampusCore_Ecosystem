// Data hooks for the student thesis screens. Live reads go through
// `useScreenQuery` (per-account cache, focus revalidation, stale banner);
// preview mode serves fixed sample data and never touches the network.
//
// `useScreenQuery` keeps the previous key's data while a new key loads, so each
// payload carries the key it was fetched for and is ignored when it differs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiClient, campusApi } from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { useLocale } from '../../i18n/locale-provider';
import { thesisMessages, type ThesisCopy } from '../../i18n/thesis-messages';
import type { AppLocale } from '../../i18n/locale';
import { thesisApi } from './thesis-api';
import {
  THESIS_ADVISOR_CONCURRENCY,
  THESIS_ADVISOR_TOPIC_CAP,
  THESIS_ROUND_PAGE_SIZE,
  THESIS_TOPIC_PAGE_SIZE,
  buildAdvisorDirectory,
  isAbortLike,
  isGroupLeader,
  mapWithConcurrency,
  pickDefaultRound,
  thesisErrorInfo,
  thesisErrorMessage,
  type AdvisorEntry,
  type ThesisGroup,
  type ThesisProgress,
  type ThesisReport,
  type ThesisRound,
  type ThesisSupervisor,
  type ThesisTopic,
} from './thesis-model';
import { thesisPreview, type ThesisPreview } from './thesis-preview';
import { selectThesisRound, useSelectedThesisRoundId } from './thesis-selection';

export interface ThesisQueryState {
  loading: boolean;
  /** Blocking error: there is nothing to show. */
  error: string | null;
  /** Stale data stays visible and the last refresh failed. */
  warning: string | null;
  reload: () => Promise<void>;
  preview: boolean;
}

function useThesisCopy(): { copy: ThesisCopy; locale: AppLocale } {
  const { locale } = useLocale();
  return { copy: thesisMessages[locale], locale };
}

function usePreviewData(locale: AppLocale): ThesisPreview {
  return useMemo(() => thesisPreview(locale), [locale]);
}

const isPreview = () => apiClient.mode === 'preview';

const noReload = async () => undefined;

// --- Rounds ---------------------------------------------------------------

export function useThesisRounds(): ThesisQueryState & { rounds: ThesisRound[] } {
  const { copy, locale } = useThesisCopy();
  const preview = isPreview();
  const sample = usePreviewData(locale);
  const query = useScreenQuery<ThesisRound[]>(
    'thesis:rounds',
    async () => (await thesisApi.rounds({ page: 0, limit: THESIS_ROUND_PAGE_SIZE })).items,
    { enabled: !preview, errorMessage: copy.errors.generic, mapError: (error) => thesisErrorMessage(copy, error) },
  );
  // A draft round is not a student-facing surface.
  const rounds = useMemo(
    () => (preview ? sample.rounds : (query.data ?? []).filter((round) => round.status !== 'DRAFT')),
    [preview, sample.rounds, query.data],
  );
  return {
    rounds,
    loading: !preview && query.isLoading,
    error: preview ? null : query.error,
    warning: preview ? null : query.warning,
    reload: preview ? noReload : query.reload,
    preview,
  };
}

export function useActiveThesisRound() {
  const rounds = useThesisRounds();
  const selectedId = useSelectedThesisRoundId();
  const round = useMemo(() => pickDefaultRound(rounds.rounds, selectedId), [rounds.rounds, selectedId]);
  return { ...rounds, round, select: selectThesisRound };
}

// --- Topics (paged) --------------------------------------------------------

interface TopicPage {
  key: string;
  items: ThesisTopic[];
  total?: number;
  hasMore: boolean;
}

interface ExtraPages {
  owner: TopicPage;
  items: ThesisTopic[];
  page: number;
  hasMore: boolean;
  error: string | null;
}

function appendUnique(base: readonly ThesisTopic[], more: readonly ThesisTopic[]): ThesisTopic[] {
  const seen = new Set(base.map((topic) => topic.id));
  return [...base, ...more.filter((topic) => !seen.has(topic.id))];
}

export interface ThesisTopicList extends ThesisQueryState {
  items: ThesisTopic[];
  total?: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: string | null;
  loadMore: () => void;
}

export function useThesisTopics(roundId: string | null): ThesisTopicList {
  const { copy, locale } = useThesisCopy();
  const preview = isPreview();
  const sample = usePreviewData(locale);
  const key = roundId ?? 'none';
  const query = useScreenQuery<TopicPage>(
    `thesis:topics:${key}`,
    async () => {
      const result = await thesisApi.topics(key, { page: 0, limit: THESIS_TOPIC_PAGE_SIZE });
      return { key, items: result.items, total: result.total, hasMore: result.hasMore };
    },
    { enabled: !preview && roundId !== null, errorMessage: copy.errors.generic, mapError: (error) => thesisErrorMessage(copy, error) },
  );
  const first = query.data && query.data.key === key ? query.data : undefined;

  const [extra, setExtra] = useState<ExtraPages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // Extra pages belong to one first-page snapshot; a refresh drops them.
  const owned = extra && first && extra.owner === first ? extra : null;
  const hasMore = preview ? false : owned ? owned.hasMore : first?.hasMore ?? false;

  const loadMore = useCallback(() => {
    if (preview || !first || busy.current || !hasMore || roundId === null) return;
    busy.current = true;
    setLoadingMore(true);
    const page = (owned?.page ?? 0) + 1;
    thesisApi.topics(roundId, { page, limit: THESIS_TOPIC_PAGE_SIZE })
      .then((result) => {
        if (!mounted.current) return;
        setExtra({ owner: first, items: appendUnique(owned?.items ?? [], result.items), page, hasMore: result.hasMore, error: null });
      })
      .catch((error: unknown) => {
        if (!mounted.current || isAbortLike(error)) return;
        const message = thesisErrorMessage(copy, error);
        setExtra({ owner: first, items: owned?.items ?? [], page: owned?.page ?? 0, hasMore: true, error: message });
      })
      .finally(() => {
        busy.current = false;
        if (mounted.current) setLoadingMore(false);
      });
  }, [preview, first, hasMore, roundId, owned, copy]);

  const items = useMemo(() => {
    if (preview) return sample.topics.filter((topic) => topic.roundId === (roundId ?? topic.roundId));
    return appendUnique(first?.items ?? [], owned?.items ?? []);
  }, [preview, sample.topics, roundId, first, owned]);

  return {
    items,
    total: preview ? items.length : first?.total,
    hasMore,
    loading: !preview && roundId !== null && query.isLoading && !first,
    loadingMore,
    loadMoreError: owned?.error ?? null,
    loadMore,
    error: preview || first ? null : query.error,
    warning: preview ? null : query.warning,
    reload: preview ? noReload : query.reload,
    preview,
  };
}

// --- One topic and its supervisors ----------------------------------------

export function useThesisTopic(topicId: string | undefined): ThesisQueryState & { topic: ThesisTopic | null } {
  const { copy, locale } = useThesisCopy();
  const preview = isPreview();
  const sample = usePreviewData(locale);
  const key = topicId ?? 'none';
  const query = useScreenQuery<{ key: string; topic: ThesisTopic }>(
    `thesis:topic:${key}`,
    async () => ({ key, topic: await thesisApi.topic(key) }),
    { enabled: !preview && Boolean(topicId), errorMessage: copy.errors.generic, mapError: (error) => thesisErrorMessage(copy, error) },
  );
  const live = query.data && query.data.key === key ? query.data.topic : null;
  const topic = preview ? sample.topics.find((item) => item.id === topicId) ?? null : live;
  return {
    topic,
    loading: !preview && Boolean(topicId) && query.isLoading && !live,
    error: preview || live ? null : topicId ? query.error : null,
    warning: preview ? null : query.warning,
    reload: preview ? noReload : query.reload,
    preview,
  };
}

export function useTopicSupervisors(topicId: string | undefined): ThesisQueryState & { supervisors: ThesisSupervisor[] } {
  const { copy, locale } = useThesisCopy();
  const preview = isPreview();
  const sample = usePreviewData(locale);
  const key = topicId ?? 'none';
  const query = useScreenQuery<{ key: string; rows: ThesisSupervisor[] }>(
    `thesis:supervisors:${key}`,
    async () => ({ key, rows: await thesisApi.supervisors(key) }),
    { enabled: !preview && Boolean(topicId), errorMessage: copy.errors.generic, mapError: (error) => thesisErrorMessage(copy, error) },
  );
  const live = query.data && query.data.key === key ? query.data.rows : undefined;
  const supervisors = preview ? (topicId ? sample.supervisors[topicId] ?? [] : []) : live ?? [];
  return {
    supervisors,
    loading: !preview && Boolean(topicId) && query.isLoading && !live,
    error: preview || live ? null : topicId ? query.error : null,
    warning: preview ? null : query.warning,
    reload: preview ? noReload : query.reload,
    preview,
  };
}

// --- The student's group and progress -------------------------------------

interface GroupSnapshot {
  key: string;
  studentId: string | null;
  group: ThesisGroup | null;
  progress: ThesisProgress | null;
}

const MY_GROUP_PAGE = 100;
const MY_GROUP_PAGE_CAP = 5;

async function loadMyGroups(): Promise<ThesisGroup[]> {
  const groups: ThesisGroup[] = [];
  for (let page = 0; page < MY_GROUP_PAGE_CAP; page += 1) {
    const result = await thesisApi.myGroups({ page, limit: MY_GROUP_PAGE });
    groups.push(...result.items);
    if (!result.hasMore) break;
  }
  return groups;
}

export interface ThesisGroupState extends ThesisQueryState {
  studentId: string | null;
  group: ThesisGroup | null;
  progress: ThesisProgress | null;
  isLeader: boolean;
  /** Applies a mutation response locally, then revalidates the progress read. */
  applyGroup: (group: ThesisGroup) => void;
}

export function useThesisGroup(roundId: string | null): ThesisGroupState {
  const { copy, locale } = useThesisCopy();
  const preview = isPreview();
  const sample = usePreviewData(locale);
  const key = roundId ?? 'none';
  const query = useScreenQuery<GroupSnapshot>(
    `thesis:group:${key}`,
    async () => {
      const [me, groups, progress] = await Promise.all([
        campusApi.profile(),
        loadMyGroups(),
        // Progress is a derived read; a group still shows when it is unavailable.
        thesisApi.progress(key).catch((error: unknown) => {
          if (thesisErrorInfo(error).kind === 'session') throw error;
          return null;
        }),
      ]);
      const inRound = groups.filter((group) => group.roundId === key);
      const group = inRound.find((item) => item.status !== 'CANCELLED') ?? inRound[0] ?? null;
      return { key, studentId: me.studentId ?? null, group, progress };
    },
    { enabled: !preview && roundId !== null, errorMessage: copy.errors.generic, mapError: (error) => thesisErrorMessage(copy, error) },
  );
  const live = query.data && query.data.key === key ? query.data : undefined;
  const { setData, reload } = query;

  const applyGroup = useCallback((next: ThesisGroup) => {
    if (preview) return;
    setData({ key, studentId: live?.studentId ?? null, group: next, progress: live?.progress ?? null });
    void reload();
  }, [preview, setData, reload, key, live]);

  const snapshot: GroupSnapshot | undefined = preview
    ? { key, studentId: 'preview-student-1', group: sample.group, progress: sample.progress }
    : live;
  return {
    studentId: snapshot?.studentId ?? null,
    group: snapshot?.group ?? null,
    progress: snapshot?.progress ?? null,
    isLeader: isGroupLeader(snapshot?.group, snapshot?.studentId),
    applyGroup,
    loading: !preview && roundId !== null && query.isLoading && !live,
    error: preview || live ? null : roundId !== null ? query.error : null,
    warning: preview ? null : query.warning,
    reload: preview ? noReload : query.reload,
    preview,
  };
}

// --- Report ------------------------------------------------------------

export interface ThesisReportState extends ThesisQueryState {
  report: ThesisReport | null;
  setReport: (report: ThesisReport | null) => void;
}

export function useThesisReport(groupId: string | null | undefined, enabled: boolean): ThesisReportState {
  const { copy, locale } = useThesisCopy();
  const preview = isPreview();
  const sample = usePreviewData(locale);
  const key = groupId ?? 'none';
  const query = useScreenQuery<{ key: string; report: ThesisReport | null }>(
    `thesis:report:${key}`,
    async () => {
      try {
        return { key, report: await thesisApi.report(key) };
      } catch (error) {
        if (thesisErrorInfo(error).kind === 'notFound') return { key, report: null };
        throw error;
      }
    },
    { enabled: !preview && enabled && Boolean(groupId), errorMessage: copy.errors.generic, mapError: (error) => thesisErrorMessage(copy, error) },
  );
  const live = query.data && query.data.key === key ? query.data : undefined;
  const { setData, reload } = query;
  const setReport = useCallback((report: ThesisReport | null) => {
    if (!preview) setData({ key, report });
  }, [preview, setData, key]);
  return {
    report: preview ? sample.report : live?.report ?? null,
    setReport,
    loading: !preview && enabled && Boolean(groupId) && query.isLoading && !live,
    error: preview || live ? null : enabled && groupId ? query.error : null,
    warning: preview ? null : query.warning,
    reload: preview ? noReload : reload,
    preview,
  };
}

// --- Advisor directory ----------------------------------------------------

interface AdvisorSnapshot {
  key: string;
  entries: AdvisorEntry[];
  /** Topics whose supervisor read failed. */
  failed: number;
  /** The round has more topics than the directory reads. */
  capped: boolean;
}

export interface AdvisorDirectory extends ThesisQueryState {
  entries: AdvisorEntry[];
  failed: number;
  capped: boolean;
}

/**
 * The lecturer directory is not readable by students, so advisors are derived
 * from each published topic's supervisors: bounded concurrency, bounded topics.
 */
export function useAdvisorDirectory(roundId: string | null): AdvisorDirectory {
  const { copy, locale } = useThesisCopy();
  const preview = isPreview();
  const sample = usePreviewData(locale);
  const key = roundId ?? 'none';
  const query = useScreenQuery<AdvisorSnapshot>(
    `thesis:advisors:${key}`,
    async () => {
      const page = await thesisApi.topics(key, { page: 0, limit: THESIS_ADVISOR_TOPIC_CAP });
      let failed = 0;
      const rows = await mapWithConcurrency(page.items, THESIS_ADVISOR_CONCURRENCY, async (topic) => {
        try {
          return { topic, supervisors: await thesisApi.supervisors(topic.id) };
        } catch (error) {
          if (thesisErrorInfo(error).kind === 'session') throw error;
          failed += 1;
          return { topic, supervisors: [] as ThesisSupervisor[] };
        }
      });
      return { key, entries: buildAdvisorDirectory(rows), failed, capped: page.hasMore };
    },
    { enabled: !preview && roundId !== null, errorMessage: copy.errors.generic, mapError: (error) => thesisErrorMessage(copy, error) },
  );
  const live = query.data && query.data.key === key ? query.data : undefined;
  const entries = useMemo(
    () => (preview
      ? buildAdvisorDirectory(sample.topics.map((topic) => ({ topic, supervisors: sample.supervisors[topic.id] ?? [] })))
      : live?.entries ?? []),
    [preview, sample, live],
  );
  return {
    entries,
    failed: preview ? 0 : live?.failed ?? 0,
    capped: preview ? false : live?.capped ?? false,
    loading: !preview && roundId !== null && query.isLoading && !live,
    error: preview || live ? null : roundId !== null ? query.error : null,
    warning: preview ? null : query.warning,
    reload: preview ? noReload : query.reload,
    preview,
  };
}
