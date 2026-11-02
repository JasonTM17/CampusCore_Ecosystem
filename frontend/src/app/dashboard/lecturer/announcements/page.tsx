'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  Bell,
  BookOpen,
  Calendar,
  CheckCircle,
  GraduationCap,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRequireAuth } from '@/context/AuthContext';
import { announcementsApi, type AnnouncementMutation, type AnnouncementRecord } from '@/lib/api';
import { AnnouncementReaderModal } from '@/components/announcements/AnnouncementReaderModal';
import { LecturerAnnouncementCreateModal } from '@/components/announcements/LecturerAnnouncementCreateModal';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { LinkButton } from '@/components/ui/link-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { statusToneClass } from '@/components/ui/status';
import { RichContentRenderer } from '@/components/ui/rich-content-renderer';
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { useI18n } from '@/i18n';
import { useOrderedPosts } from '@/components/providers/SiteAppearanceProvider';
import {
  announcementAudienceBadge,
  announcementAudienceType,
  announcementIsUpdated,
  announcementPriorityLabel,
  announcementPriorityTone,
  announcementSectionLabel,
  announcementSemesterName,
  formatAnnouncementPublisher,
  formatAnnouncementSemester,
} from '@/lib/announcement-presentation';
import { cn } from '@/lib/utils';
import {
  announcementWorkspaceEn,
  announcementWorkspaceVi,
} from '@/i18n/messages-announcements';
import { hasNextPage } from '@/lib/pager';
import { createRequestEpoch } from '@/lib/request-epoch';

type LecturerNoticeCategory =
  | 'ALL'
  | 'GLOBAL'
  | 'LECTURER_ONLY'
  | 'EXAM_GRADES'
  | 'RESEARCH_SYLLABUS';

type QueueStatusFilter = 'ALL' | 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED';

export default function LecturerAnnouncementsPage() {
  const auth = useRequireAuth(['LECTURER']);
  return <LecturerAnnouncementsWorkspace key={auth.user?.id ?? 'anonymous'} auth={auth} />;
}

function LecturerAnnouncementsWorkspace({ auth }: { auth: ReturnType<typeof useRequireAuth> }) {
  const { user, hasAccess, isLoading: authLoading, isForbidden } = auth;
  const { locale, formatDateTime, messages } = useI18n();
  const lifecycleCopy = messages.content.lifecycle;
  const [items, setItems] = useState<AnnouncementRecord[]>([]);
  const orderedItems = useOrderedPosts(items);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  // Feed pagination: the backend caps a page, so notices past page 1 stay
  // reachable through an explicit load-more instead of being cut off silently.
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<LecturerNoticeCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [readingNotice, setReadingNotice] = useState<AnnouncementRecord | null>(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  // publication-policy §3 (KM-C1c): the authored surface is the scoped list
  // — own posts in every status plus the IN_REVIEW queue — with status
  // filters, never a hidden /mine route. Without it a UI-created draft has
  // no visible submit path and strands (KM-M13).
  const [queueStatus, setQueueStatus] = useState<QueueStatusFilter>('ALL');
  const [queueItems, setQueueItems] = useState<AnnouncementRecord[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState(false);
  const [queuePage, setQueuePage] = useState(1);
  const [queueTotalPages, setQueueTotalPages] = useState(1);
  const [queueLoadingMore, setQueueLoadingMore] = useState(false);
  const [queueLoadMoreError, setQueueLoadMoreError] = useState(false);
  const queueMutationRef = useRef<string | null>(null);
  const [queueMutationKey, setQueueMutationKey] = useState<string | null>(null);
  const [returnTarget, setReturnTarget] = useState<AnnouncementRecord | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const feedEpoch = useRef(createRequestEpoch()).current;
  const queueEpoch = useRef(createRequestEpoch()).current;
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => () => {
    feedEpoch.invalidate();
  }, [feedEpoch]);

  useEffect(() => () => {
    queueEpoch.invalidate();
  }, [queueEpoch]);

  const copy = { en: announcementWorkspaceEn, vi: announcementWorkspaceVi }[locale].lecturer;

  const fetchFeed = useCallback(async (nextPage = 1) => {
    const epoch = feedEpoch.begin();
    if (nextPage === 1) {
      setIsLoading(true);
      setIsLoadingMore(false);
      setLoadMoreError(false);
      setError('');
    } else {
      setIsLoadingMore(true);
      setLoadMoreError(false);
    }

    try {
      const response = await announcementsApi.getMy({ page: nextPage, limit: 25 });
      if (!feedEpoch.isCurrent(epoch)) return;
      const data = response.data ?? [];
      // Page 1 replaces the feed; later pages append so the reader keeps what
      // is already on screen. Dedupe by id — offset pagination shifts when a
      // new notice lands between page fetches.
      setItems((current) => {
        if (nextPage === 1) return data;
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...data.filter((item) => !seen.has(item.id))];
      });
      setTotalPages(Math.max(response.meta?.totalPages ?? 1, 1));
      setPage(nextPage);
    } catch {
      if (!feedEpoch.isCurrent(epoch)) return;
      if (nextPage === 1) {
        setError(copy.loadFailed);
      } else {
        setLoadMoreError(true);
      }
    } finally {
      if (!feedEpoch.isCurrent(epoch)) return;
      if (nextPage === 1) {
        setIsLoading(false);
      } else {
        setIsLoadingMore(false);
      }
    }
  }, [copy.loadFailed, feedEpoch]);

  const fetchQueue = useCallback(async (nextPage = 1) => {
    const epoch = queueEpoch.begin();
    if (nextPage === 1) {
      setQueueLoading(true);
      setQueueError(false);
    } else {
      setQueueLoadingMore(true);
      setQueueLoadMoreError(false);
    }
    try {
      const response = await announcementsApi.getAll({
        status: queueStatus,
        page: nextPage,
        limit: 50,
      });
      if (!queueEpoch.isCurrent(epoch)) return;
      const data = response.data ?? [];
      setQueueItems((current) => {
        if (nextPage === 1) return data;
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...data.filter((item) => !seen.has(item.id))];
      });
      setQueueTotalPages(Math.max(response.meta?.totalPages ?? 1, 1));
      setQueuePage(nextPage);
    } catch {
      if (!queueEpoch.isCurrent(epoch)) return;
      if (nextPage === 1) {
        setQueueError(true);
      } else {
        setQueueLoadMoreError(true);
      }
    } finally {
      if (!queueEpoch.isCurrent(epoch)) return;
      if (nextPage === 1) {
        setQueueLoading(false);
      } else {
        setQueueLoadingMore(false);
      }
    }
  }, [queueEpoch, queueStatus]);

  useEffect(() => {
    if (hasAccess) {
      void fetchFeed();
      void fetchQueue();
    }
  }, [fetchFeed, fetchQueue, hasAccess]);

  const beginQueueMutation = (actionKey: string) => {
    if (queueMutationRef.current !== null) return false;
    queueMutationRef.current = actionKey;
    setQueueMutationKey(actionKey);
    return true;
  };

  const finishQueueMutation = (actionKey: string) => {
    if (queueMutationRef.current !== actionKey) return;
    queueMutationRef.current = null;
    setQueueMutationKey(null);
  };

  /** DRAFT -> IN_REVIEW (own posts) or IN_REVIEW -> PUBLISHED (others'). */
  const runQueueWorkflow = async (
    item: AnnouncementRecord,
    action: 'submit' | 'approve',
  ) => {
    const actionKey = `${action}:${item.id}`;
    if (!beginQueueMutation(actionKey)) return;
    try {
      if (action === 'submit') {
        await announcementsApi.submit(item.id);
        toast.success(lifecycleCopy.submitted);
      } else {
        await announcementsApi.approve(item.id);
        toast.success(lifecycleCopy.approved);
      }
      await fetchQueue();
    } catch {
      toast.error(
        copy.transitionFailed,
      );
    } finally {
      finishQueueMutation(actionKey);
    }
  };

  /** IN_REVIEW -> DRAFT — the reviewer note is mandatory (publication-policy §3). */
  const submitReturn = async () => {
    if (!returnTarget || !returnReason.trim()) {
      toast.error(lifecycleCopy.returnReasonRequired);
      return;
    }
    const actionKey = `return:${returnTarget.id}`;
    if (!beginQueueMutation(actionKey)) return;
    try {
      await announcementsApi.returnForRework(returnTarget.id, { reason: returnReason.trim() });
      toast.success(lifecycleCopy.returned);
      setReturnTarget(null);
      setReturnReason('');
      await fetchQueue();
    } catch {
      toast.error(
        copy.returnFailed,
      );
    } finally {
      finishQueueMutation(actionKey);
    }
  };

  // Same fake-search guard as the student feed: while a keyword or category
  // chip is active the feed walks itself to the last page so the filter
  // actually covers the full notice list, not just the first loaded page.
  const filterActive = selectedCategory !== 'ALL' || searchQuery.trim() !== '';
  useEffect(() => {
    // loadMoreError stops the walk — a failed page waits for an explicit
    // "load more" press rather than spinning in a silent retry loop.
    if (!filterActive || isLoading || isLoadingMore || loadMoreError || page >= totalPages) return;
    void fetchFeed(page + 1);
  }, [filterActive, isLoading, isLoadingMore, loadMoreError, page, totalPages, fetchFeed]);

  const handleArchiveOwn = async (announcement: AnnouncementRecord) => {
    const actionKey = `archive:${announcement.id}`;
    if (!beginQueueMutation(actionKey)) return;
    try {
      const confirmed = await confirm({
        title: copy.archiveTitle,
        message: copy.archiveMessage,
        confirmText: copy.archiveConfirm,
        cancelText: copy.archiveCancel,
        variant: 'destructive',
      });
      if (!confirmed) return;
      setArchivingId(announcement.id);
      try {
        await announcementsApi.delete(announcement.id);
        toast.success(copy.archived);
        await fetchFeed(1);
        await fetchQueue();
      } catch {
        toast.error(copy.archiveFailed);
      }
    } finally {
      setArchivingId(null);
      finishQueueMutation(actionKey);
    }
  };

  const filteredNotices = useMemo(() => {
    return orderedItems.filter((item) => {
      if (selectedCategory === 'GLOBAL') {
        const type = announcementAudienceType(item);
        if (type !== 'GLOBAL') return false;
      } else if (selectedCategory === 'LECTURER_ONLY') {
        const type = announcementAudienceType(item);
        if (type !== 'LECTURER') return false;
      } else if (selectedCategory === 'EXAM_GRADES') {
        const text = (item.title + ' ' + item.content).toLowerCase();
        if (
          !text.includes('coi thi') &&
          !text.includes('đề thi') &&
          !text.includes('điểm') &&
          !text.includes('khảo thí') &&
          !text.includes('exam')
        )
          return false;
      } else if (selectedCategory === 'RESEARCH_SYLLABUS') {
        const text = (item.title + ' ' + item.content).toLowerCase();
        if (
          !text.includes('nckh') &&
          !text.includes('nghiên cứu') &&
          !text.includes('đề tài') &&
          !text.includes('đề cương') &&
          !text.includes('abet') &&
          !text.includes('syllabus')
        )
          return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const fullText = (item.title + ' ' + item.content).toLowerCase();
        return fullText.includes(q);
      }

      return true;
    });
  }, [orderedItems, selectedCategory, searchQuery]);

  if (authLoading) {
    return <LoadingState label={copy.loading} />;
  }

  if (isForbidden || !hasAccess) {
    return <WorkspaceForbiddenState signedIn={Boolean(user)} />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
        title={copy.title}
        description={copy.description}
        actions={
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => setIsComposerOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {copy.draftAction}
            </Button>
            <LinkButton
              href="/dashboard/lecturer"
              variant="outline"
              aria-label={copy.backToDashboard}
              title={copy.backToDashboard}
            >
              {copy.backToDashboard}
            </LinkButton>
            <Button
              type="button"
              variant="outline"
              onClick={() => void fetchFeed()}
              disabled={isLoading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 motion-reduce:animate-none ${isLoading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {copy.refresh}
            </Button>
          </div>
        }
      />

      <LecturerAnnouncementCreateModal
        isOpen={isComposerOpen}
        onClose={() => setIsComposerOpen(false)}
        onSuccess={() => {
          void fetchFeed();
          void fetchQueue();
        }}
        lecturerName={user ? `${user.lastName ?? ''} ${user.firstName ?? ''}`.trim() : undefined}
      />

      {/* Control Bar: Search & Category Tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'ALL', label: copy.filterAll },
              { id: 'GLOBAL', label: copy.filterGlobal },
              { id: 'LECTURER_ONLY', label: copy.filterLecturerOnly },
              { id: 'EXAM_GRADES', label: copy.filterExamGrades },
              { id: 'RESEARCH_SYLLABUS', label: copy.filterResearch },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={selectedCategory === tab.id}
              onClick={() => setSelectedCategory(tab.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                selectedCategory === tab.id
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={copy.searchPlaceholder}
            aria-label={copy.searchPlaceholder}
            className="h-9 rounded-lg pl-9 text-xs"
          />
        </div>
      </div>

      {/* Authored notices + review queue — publication-policy §3 (KM-C1c). */}
      <Card variant="muted">
        <CardHeader>
          <CardTitle className="text-xl">{copy.queueTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {(['ALL', 'DRAFT', 'IN_REVIEW', 'PUBLISHED'] as const).map((statusKey) => (
              <button
                key={statusKey}
                type="button"
                aria-pressed={queueStatus === statusKey}
                onClick={() => setQueueStatus(statusKey)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                  queueStatus === statusKey
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                {lifecycleCopy.filter[statusKey]}
              </button>
            ))}
          </div>
          {queueLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {copy.loading}
            </div>
          ) : queueError ? (
            <ErrorState
              title={copy.unavailableTitle}
              description={copy.queueLoadFailed}
              onRetry={() => void fetchQueue()}
            />
          ) : queueItems.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{copy.queueEmpty}</p>
          ) : (
            queueItems.map((item) => {
              const isOwn = Boolean(item.authorId) && item.authorId === user?.id;
              const statusKey = item.status as keyof typeof lifecycleCopy.status | undefined;
              const statusLabel = statusKey ? lifecycleCopy.status[statusKey] : (item.status ?? '');
              return (
                <article
                  key={item.id}
                  className="rounded-lg border border-border/70 bg-card p-4 shadow-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(
                          'rounded-md px-2.5 py-0.5 text-xs font-semibold border',
                          item.status === 'PUBLISHED'
                            ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400'
                            : item.status === 'IN_REVIEW'
                              ? 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400'
                              : item.status === 'ARCHIVED'
                                ? 'bg-secondary text-muted-foreground border-border/60'
                                : 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400',
                        )}>
                          {statusLabel}
                        </span>
                        <span className="rounded-md bg-secondary px-2.5 py-0.5 text-xs font-semibold text-foreground border border-border/60">
                          {isOwn ? copy.queueOwnBadge : copy.queueReviewBadge}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
                      {item.reviewNote ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          {lifecycleCopy.reviewNoteLabel}: {item.reviewNote}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(item.updatedAt || item.createdAt)}
                      </p>
                    </div>
                    <div className="inline-flex shrink-0 items-center gap-1">
                      {item.status === 'DRAFT' && isOwn ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => void runQueueWorkflow(item, 'submit')}
                          aria-label={`${lifecycleCopy.actions.submit}: ${item.title}`}
                          title={lifecycleCopy.actions.submit}
                          disabled={queueMutationKey === `submit:${item.id}`}
                        >
                          {queueMutationKey === `submit:${item.id}`
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <Send className="h-4 w-4" aria-hidden="true" />}
                        </Button>
                      ) : null}
                      {item.status === 'IN_REVIEW' && !isOwn ? (
                        <>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => void runQueueWorkflow(item, 'approve')}
                            aria-label={`${lifecycleCopy.actions.approve}: ${item.title}`}
                            title={lifecycleCopy.actions.approve}
                            disabled={queueMutationKey === `approve:${item.id}`}
                          >
                            <CheckCircle className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setReturnTarget(item);
                              setReturnReason('');
                            }}
                            aria-label={`${lifecycleCopy.actions.returnForRework}: ${item.title}`}
                            title={lifecycleCopy.actions.returnForRework}
                            disabled={queueMutationKey === `return:${item.id}`}
                          >
                            <Undo2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </>
                      ) : null}
                      {isOwn && !item.archivedAt ? (
                        <button
                          type="button"
                          onClick={() => void handleArchiveOwn(item)}
                          disabled={queueMutationKey === `archive:${item.id}`}
                          className="inline-flex items-center gap-1.5 px-2 text-xs font-bold text-destructive/80 hover:text-destructive hover:underline disabled:opacity-50"
                        >
                          <Archive className="h-3.5 w-3.5" />
                          {archivingId === item.id
                            ? copy.archiving
                            : copy.archiveAction}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })
          )}
          {!queueLoading && !queueError && hasNextPage(queuePage, queueTotalPages) ? (
            <div className="flex flex-col items-center gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void fetchQueue(queuePage + 1)}
                disabled={queueLoadingMore}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 motion-reduce:animate-none ${queueLoadingMore ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {queueLoadingMore ? copy.loadingMore : copy.loadMore}
              </Button>
              {queueLoadMoreError ? (
                <p className="text-xs text-destructive" role="alert">{copy.loadMoreFailed}</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <ErrorState
          title={copy.unavailableTitle}
          description={error}
          onRetry={() => void fetchFeed()}
        />
      ) : isLoading ? (
        <LoadingState label={copy.loading} />
      ) : filteredNotices.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={copy.emptyTitle}
          description={copy.emptyDescription}
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSelectedCategory('ALL');
                setSearchQuery('');
              }}
              className="rounded-lg"
            >
              {copy.filterAll}
            </Button>
          }
        />
      ) : (
        <Card variant="muted">
          <CardHeader>
            <CardTitle className="text-xl">{copy.recentNotices}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {filteredNotices.map((announcement) => {
              const semesterLabel = formatAnnouncementSemester(announcement, locale, copy.semesterPrefix);
              return (
                <article
                  key={announcement.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setReadingNotice(announcement)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setReadingNotice(announcement);
                    }
                  }}
                  className="group cursor-pointer rounded-lg border border-border/70 bg-card p-5 shadow-xs transition-all hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary border border-primary/20">
                        <GraduationCap className="h-3.5 w-3.5" />
                        {formatAnnouncementPublisher(announcement.publishedBy, locale, copy.officialBadge)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2.5 py-0.5 text-xs font-semibold text-foreground border border-border/60">
                        {announcementAudienceBadge(announcement, locale).label}
                      </span>
                      <span
                        className={`rounded-md px-2.5 py-0.5 text-xs font-semibold ${statusToneClass(announcementPriorityTone(announcement.priority))}`}
                      >
                        {announcementPriorityLabel(announcement.priority, locale)}
                      </span>
                      {announcementIsUpdated(announcement) ? (
                        <span className="rounded-md bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                          {copy.updated}
                        </span>
                      ) : null}
                    </div>
                    <h2 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                      {announcement.title}
                    </h2>
                    <div className="line-clamp-3 max-w-3xl text-sm leading-7 text-muted-foreground prose prose-sm dark:prose-invert">
                      <RichContentRenderer content={announcement.content} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border/50">
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {semesterLabel ? (
                          <span className="rounded bg-secondary/70 px-2 py-0.5 font-medium">
                            {semesterLabel}
                          </span>
                        ) : null}
                        {announcementSectionLabel(announcement) ? (
                          <span className="rounded bg-secondary/70 px-2 py-0.5 font-medium">
                            {copy.sectionPrefix}: {announcementSectionLabel(announcement)}
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-primary" />
                          {formatDateTime(announcement.publishAt || announcement.createdAt)}
                        </span>
                      </div>

                      <div className="inline-flex items-center gap-3">
                        {announcement.lecturerId && announcement.lecturerId === user?.lecturerId ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleArchiveOwn(announcement);
                            }}
                            disabled={queueMutationKey === `archive:${announcement.id}`}
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-destructive/80 hover:text-destructive hover:underline disabled:opacity-50"
                          >
                            <Archive className="h-3.5 w-3.5" />
                            {archivingId === announcement.id
                              ? copy.archiving
                              : copy.archiveAction}
                          </button>
                        ) : null}
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-primary group-hover:underline">
                          <BookOpen className="h-3.5 w-3.5" />
                          {copy.readFull}
                          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Load more: notices past the first page stay reachable. */}
      {!error && !isLoading && page < totalPages ? (
        <div className="flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void fetchFeed(page + 1)}
            disabled={isLoadingMore}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 motion-reduce:animate-none ${isLoadingMore ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {isLoadingMore ? copy.loadingMore : copy.loadMore}
          </Button>
          {loadMoreError ? (
            <p className="text-xs text-destructive" role="alert">{copy.loadMoreFailed}</p>
          ) : null}
        </div>
      ) : null}

      {returnTarget ? (
        <Modal
          isOpen
          onClose={() => setReturnTarget(null)}
          title={lifecycleCopy.returnReasonTitle}
          className="max-w-lg"
        >
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void submitReturn();
            }}
          >
            <p className="text-sm leading-6 text-muted-foreground">
              {lifecycleCopy.returnReasonLabel}
            </p>
            <p className="rounded-md border border-border/70 bg-secondary/25 p-4 font-semibold text-foreground">
              {returnTarget.title}
            </p>
            <Textarea
              autoFocus
              value={returnReason}
              onChange={(event) => setReturnReason(event.target.value)}
              placeholder={lifecycleCopy.returnReasonPlaceholder}
              rows={4}
              maxLength={500}
            />
            <div className="flex items-center justify-end gap-3 border-t border-border/70 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setReturnTarget(null)}
                disabled={queueMutationKey === `return:${returnTarget.id}`}
              >
                {copy.queueCancel}
              </Button>
              <Button type="submit" disabled={queueMutationKey === `return:${returnTarget.id}`}>
                {lifecycleCopy.actions.returnForRework}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {confirmationDialog}

      {/* Official Stationery Reader Modal */}
      <AnnouncementReaderModal
        announcement={readingNotice}
        isOpen={Boolean(readingNotice)}
        onClose={() => setReadingNotice(null)}
        allAnnouncements={items}
        onSelectAnnouncement={(ann) => setReadingNotice(ann)}
      />
    </div>
  );
}
