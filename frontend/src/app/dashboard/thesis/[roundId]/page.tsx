'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  FileStack,
  UsersRound,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { LocalizedLink } from '@/components/LocalizedLink';
import { StatusBadge } from '@/components/thesis/StatusBadge';
import { WorkspaceMetricCard } from '@/components/dashboard/WorkspaceSurface';
import { ListPager } from '@/components/ui/list-pager';
import { metricToneClass } from '@/components/ui/status';
import { useRequireAuth } from '@/context/AuthContext';
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { useI18n } from '@/i18n';
import {
  thesisApi,
  type ThesisRound,
  type ThesisTopic,
  type ThesisTopicStatus,
} from '@/lib/thesis-api';
import { useThesisPagedList } from '@/components/dashboard/thesis/useThesisPagedList';
import { plainTextThesisDescription } from '@/lib/thesis-text';

const PAGE_SIZE = 20;
const TOPIC_STATUS: ThesisTopicStatus = 'PUBLISHED';

interface RoundReadState {
  key: string | null;
  round: ThesisRound | null;
  loading: boolean;
  failed: boolean;
}

export default function ThesisRoundDetailPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const { messages } = useI18n();
  const { user, isLoading: authLoading, hasAccess, isForbidden } = useRequireAuth();
  const accountId = user?.id ?? '';
  const authorizationScope = JSON.stringify([
    [...(user?.roles ?? [])].sort(),
    user?.studentId ?? null,
    user?.lecturerId ?? null,
  ]);
  const authSignature = JSON.stringify([accountId, authLoading]);
  const authSessionRef = useRef({ signature: authSignature, epoch: 0 });
  if (authSessionRef.current.signature !== authSignature) {
    authSessionRef.current = {
      signature: authSignature,
      epoch: authSessionRef.current.epoch + 1,
    };
  }
  const authSessionEpoch = authSessionRef.current.epoch;

  const [roundRetryGeneration, setRoundRetryGeneration] = useState(0);
  const roundKey = JSON.stringify([
    accountId,
    authSessionEpoch,
    authorizationScope,
    roundId,
    roundRetryGeneration,
  ]);
  const roundKeyRef = useRef(roundKey);
  roundKeyRef.current = roundKey;
  const roundSequenceRef = useRef(0);
  const [roundState, setRoundState] = useState<RoundReadState>({
    key: null,
    round: null,
    loading: true,
    failed: false,
  });
  const currentRoundState: RoundReadState = roundState.key === roundKey
    ? roundState
    : { key: roundKey, round: null, loading: true, failed: false };

  useEffect(() => {
    if (authLoading || !hasAccess || isForbidden || !roundId) return undefined;
    const requestSequence = ++roundSequenceRef.current;
    const requestKey = roundKey;
    let active = true;
    const isCurrent = () =>
      active &&
      roundSequenceRef.current === requestSequence &&
      roundKeyRef.current === requestKey;

    setRoundState({ key: requestKey, round: null, loading: true, failed: false });
    void thesisApi.listRounds()
      .then((rounds) => {
        if (!isCurrent()) return;
        setRoundState({
          key: requestKey,
          round: rounds.find((candidate) => candidate.id === roundId) ?? null,
          loading: true,
          failed: false,
        });
      })
      .catch(() => {
        if (isCurrent()) {
          setRoundState({ key: requestKey, round: null, loading: true, failed: true });
        }
      })
      .finally(() => {
        if (!isCurrent()) return;
        setRoundState((current) => current.key === requestKey
          ? { ...current, loading: false }
          : current);
      });

    return () => {
      active = false;
    };
  }, [authLoading, hasAccess, isForbidden, roundId, roundKey]);

  const loadTopics = useCallback((page: number, signal: AbortSignal) => {
    if (!roundId) throw new Error('Missing thesis round.');
    return thesisApi.listTopicsPage(
      roundId,
      { status: TOPIC_STATUS, page, limit: PAGE_SIZE },
      signal,
    );
  }, [roundId]);
  const loadGroups = useCallback((page: number, signal: AbortSignal) => {
    if (!roundId) throw new Error('Missing thesis round.');
    return thesisApi.listGroupsPage(roundId, { page, limit: PAGE_SIZE }, signal);
  }, [roundId]);

  const listEnabled = Boolean(!authLoading && hasAccess && !isForbidden && roundId);
  const topics = useThesisPagedList<ThesisTopic>({
    accountId,
    authSessionEpoch,
    authorizationScope,
    roundId: roundId ?? '',
    listKind: 'topics',
    status: TOPIC_STATUS,
    limit: PAGE_SIZE,
    enabled: listEnabled,
    load: loadTopics,
  });
  const groups = useThesisPagedList({
    accountId,
    authSessionEpoch,
    authorizationScope,
    roundId: roundId ?? '',
    listKind: 'groups',
    limit: PAGE_SIZE,
    enabled: listEnabled,
    load: loadGroups,
  });

  const statusLabel = (status: string) =>
    messages.thesis.status[status as keyof typeof messages.thesis.status] ??
    messages.common.statuses[status.toUpperCase() as keyof typeof messages.common.statuses] ??
    messages.common.statuses.UNKNOWN;
  const pagerCopy = messages.thesisWorkflow.listPager;

  if (authLoading) {
    return <LoadingState label={messages.thesis.loading} />;
  }

  if (isForbidden || !hasAccess) {
    return <WorkspaceForbiddenState signedIn={Boolean(user)} />;
  }

  if (currentRoundState.loading) {
    return <LoadingState label={messages.thesis.loading} />;
  }

  if (currentRoundState.failed || !currentRoundState.round) {
    return (
      <ErrorState
        title={messages.thesis.loadFailed}
        description={currentRoundState.failed ? messages.thesis.loadFailed : messages.thesis.noRound}
        retryLabel={messages.thesis.retry}
        onRetry={() => setRoundRetryGeneration((generation) => generation + 1)}
      />
    );
  }

  const round = currentRoundState.round;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>{messages.thesis.eyebrow}</SectionEyebrow>}
        title={round.name}
        description={messages.thesis.description}
        actions={
          <div className="flex flex-wrap gap-2">
            <LocalizedLink href="/dashboard/thesis">
              <span className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/50">
                <ArrowLeft className="h-4 w-4" />
                {messages.thesis.backToWorkspace}
              </span>
            </LocalizedLink>
            {user?.roles?.includes('STUDENT') ? (
              <LocalizedLink href="/dashboard/thesis/progress">
                <span className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/50">
                  <CalendarDays className="h-4 w-4" />
                  {messages.thesis.progress.eyebrow}
                </span>
              </LocalizedLink>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <WorkspaceMetricCard label={messages.thesis.roundStatus} value={statusLabel(round.status)} icon={<CalendarDays className="h-5 w-5" />} toneClassName={metricToneClass('warning')} />
        <WorkspaceMetricCard label={messages.thesis.topics} value={topics.total ?? '—'} icon={<FileStack className="h-5 w-5" />} toneClassName={metricToneClass('info')} />
        <WorkspaceMetricCard label={messages.thesis.groups} value={groups.total ?? '—'} icon={<UsersRound className="h-5 w-5" />} toneClassName={metricToneClass('success')} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>{messages.thesis.topicsTitle}</CardTitle>
            <CardDescription>{messages.thesis.topicsDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {topics.failed ? (
              <ErrorState
                title={messages.thesis.loadFailed}
                description={messages.thesis.loadFailed}
                retryLabel={messages.thesis.retry}
                onRetry={topics.retry}
              />
            ) : topics.loading ? (
              <LoadingState label={messages.thesis.loading} />
            ) : topics.items.length === 0 ? (
              <EmptyState icon={FileStack} title={messages.thesis.noTopics} description={messages.thesis.noTopicsDescription} className="min-h-[200px]" />
            ) : (
              <div className="space-y-3">
                {topics.items.map((topic) => (
                  <article key={topic.id} className="rounded-xl border border-border/70 bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold leading-6 text-foreground">{topic.title}</h3>
                      <StatusBadge status={topic.status} />
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground" title={plainTextThesisDescription(topic.description)}>{plainTextThesisDescription(topic.description)}</p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {messages.thesis.detail.maxGroups}: {topic.maxGroups}
                    </p>
                  </article>
                ))}
              </div>
            )}
            <ListPager
              testId="thesis-topics-pager"
              navLabel={pagerCopy.topicsNav}
              page={topics.page}
              limit={topics.limit}
              total={topics.total}
              itemCount={topics.items.length}
              pending={topics.loading}
              copy={pagerCopy}
              onPage={topics.goToPage}
            />
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardTitle>{messages.thesis.detail.groupsTitle}</CardTitle>
            <CardDescription>{messages.thesis.detail.groupsDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {groups.failed ? (
              <ErrorState
                title={messages.thesis.loadFailed}
                description={messages.thesis.loadFailed}
                retryLabel={messages.thesis.retry}
                onRetry={groups.retry}
              />
            ) : groups.loading ? (
              <LoadingState label={messages.thesis.loading} />
            ) : groups.items.length === 0 ? (
              <EmptyState icon={UsersRound} title={messages.thesis.detail.noGroups} description={messages.thesis.detail.noGroupsDescription} className="min-h-[200px]" />
            ) : (
              <div className="space-y-3">
                {groups.items.map((group, index) => {
                  const rowNumber = groups.page * groups.limit + index + 1;
                  return (
                    <div key={group.id} className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-card p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                          {rowNumber}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {messages.thesis.groupsTitle} #{rowNumber}
                          </p>
                          <p className="font-mono text-xs text-muted-foreground">{group.memberStudentIds.length} {messages.thesis.detail.members}</p>
                        </div>
                      </div>
                      <StatusBadge status={group.approvalStatus} variant="approval" />
                    </div>
                  );
                })}
              </div>
            )}
            <ListPager
              testId="thesis-groups-pager"
              navLabel={pagerCopy.groupsNav}
              page={groups.page}
              limit={groups.limit}
              total={groups.total}
              itemCount={groups.items.length}
              pending={groups.loading}
              copy={pagerCopy}
              onPage={groups.goToPage}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
