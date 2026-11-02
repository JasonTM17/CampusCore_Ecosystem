'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { announcementsApi } from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import { Button } from '@/components/ui/button';
import { DragHandle, SortableList } from '@/components/ui/sortable-list';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LinkButton } from '@/components/ui/link-button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { useRovingTabs } from '@/components/ui/use-roving-tabs';
import { useI18n } from '@/i18n';
import {
  DEFAULT_SITE_APPEARANCE,
  SITE_APPEARANCE_ACCENTS,
  applyPageOrder,
  movePostOrder,
  sanitizeSiteAppearance,
  type SiteAppearance,
  type SiteAppearanceAccent,
} from '@/lib/site-appearance';
import {
  broadcastSiteAppearance,
  fetchSiteAppearanceSnapshot,
  saveSiteAppearance,
} from '@/lib/site-appearance-client';
import { cn } from '@/lib/utils';

type AnnouncementRow = {
  id: string;
  title: string;
};

function mergeSavedAppearanceMetadata(current: SiteAppearance, saved: SiteAppearance): SiteAppearance {
  return {
    ...current,
    version: saved.version,
    updatedAt: saved.updatedAt,
  };
}

function isStaleVersionError(error: unknown): boolean {
  const response = (error as { response?: { data?: { code?: unknown } } })?.response;
  return response?.data?.code === 'STALE_VERSION';
}

export default function AdminAppearancePage() {
  const { user, isAdmin, isSuperAdmin, isLoading: isAuthLoading, isLoggingOut } = useAuth();
  const { href, locale, messages } = useI18n();
  const router = useRouter();
  const copy = messages.admin.appearance;
  const [draft, setDraft] = useState<SiteAppearance>(DEFAULT_SITE_APPEARANCE);
  const draftRef = useRef<SiteAppearance>(DEFAULT_SITE_APPEARANCE);
  const storedVersionRef = useRef<number | null>(null);
  const staleConflictRef = useRef(false);
  const updateDraft = useCallback((next: SiteAppearance | ((current: SiteAppearance) => SiteAppearance)) => {
    const value = typeof next === 'function' ? next(draftRef.current) : next;
    draftRef.current = value;
    setDraft(value);
  }, []);
  const [copyLocale, setCopyLocale] = useState<'en' | 'vi'>(locale);
  const copyLocaleTabs = useRovingTabs(['en', 'vi'], copyLocale, setCopyLocale);
  const [posts, setPosts] = useState<AnnouncementRow[]>([]);
  const [postsLoadFailed, setPostsLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);
  const [staleConflict, setStaleConflict] = useState(false);
  const [error, setError] = useState('');
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));

  useEffect(() => {
    if (isAuthLoading || isLoggingOut) {
      return;
    }

    if (!user) {
      router.replace(`${href('/login')}?portal=admin&reason=session-expired`);
      return;
    }

    if (!isAdmin && !isSuperAdmin) {
      router.replace(href('/dashboard'));
    }
  }, [href, isAdmin, isSuperAdmin, isAuthLoading, isLoggingOut, router, user]);

  // The pinned-order editor needs the whole catalog — a limit-20 page made
  // announcements 21+ unreachable, and a swallowed fetch error rendered the
  // same "no announcements" empty state as an actually empty catalog.
  const fetchAllAnnouncementRows = useCallback(async (): Promise<AnnouncementRow[]> => {
    const first = await announcementsApi.getAll({ page: 1, limit: 100 });
    const totalPages = first.meta?.totalPages ?? 1;
    if (totalPages <= 1) {
      return first.data ?? [];
    }
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        announcementsApi.getAll({ page: index + 2, limit: 100 })),
    );
    return [first.data ?? [], ...rest.map((page) => page.data ?? [])].flat();
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    setPostsLoadFailed(false);

    let postsFailed = false;
    try {
      const [snapshot, announcements] = await Promise.all([
        fetchSiteAppearanceSnapshot(),
        fetchAllAnnouncementRows().catch(() => {
          postsFailed = true;
          return [] as AnnouncementRow[];
        }),
      ]);
      const rows = announcements.map((item) => ({
        id: item.id,
        title: item.title,
      }));
      // The fetched rows arrive in server display order. Re-seating the pinned
      // order against them here overwrote every relative move the admin had
      // made — and broadcasting the draft then pushed that clobbered order to
      // the live homepage without the admin doing anything. Loading must keep
      // the stored pin exactly as saved; the list below is rendered through
      // the `orderedPosts` rank map instead, and a broadcast only happens on
      // an explicit save (persist/reorder).
      setPosts(rows);
      setPostsLoadFailed(postsFailed);
      updateDraft(sanitizeSiteAppearance(snapshot.appearance));
      storedVersionRef.current = snapshot.expectedVersion;
      staleConflictRef.current = false;
      setStaleConflict(false);
    } catch {
      setError(copy.loadFailed);
    } finally {
      setIsLoading(false);
    }
  }, [copy.loadFailed, fetchAllAnnouncementRows, updateDraft]);

  useEffect(() => {
    if (canAccess) {
      void load();
    }
  }, [canAccess, load]);

  const pendingAppearanceSaveRef = useRef<SiteAppearance | null>(null);
  const appearanceSaveInFlightRef = useRef(false);
  const persist = useCallback(async (next: SiteAppearance) => {
    if (staleConflictRef.current) return;
    pendingAppearanceSaveRef.current = next;
    if (appearanceSaveInFlightRef.current) return;

    appearanceSaveInFlightRef.current = true;
    setIsSaving(true);
    try {
      while (pendingAppearanceSaveRef.current) {
        const snapshot = pendingAppearanceSaveRef.current;
        pendingAppearanceSaveRef.current = null;
        try {
          const saved = await saveSiteAppearance(snapshot, storedVersionRef.current);
          storedVersionRef.current = saved.persisted ? saved.version : null;
          const current = mergeSavedAppearanceMetadata(draftRef.current, saved);
          updateDraft(current);

          if (pendingAppearanceSaveRef.current) {
            pendingAppearanceSaveRef.current = mergeSavedAppearanceMetadata(
              pendingAppearanceSaveRef.current,
              saved,
            );
          } else {
            broadcastSiteAppearance(current);
            setSavedLocally(saved.persisted === false);
            if (saved.persisted === false) {
              // The API row is the only store that survives a redeploy; say so
              // instead of letting the admin believe the whole portal was updated.
              toast.warning(copy.saveNotDurable);
            }
          }
        } catch (cause) {
          if (isStaleVersionError(cause)) {
            // Another administrator saved first. Keep this admin's edits and
            // stop: retrying the queued snapshot would overwrite that save.
            pendingAppearanceSaveRef.current = null;
            staleConflictRef.current = true;
            setStaleConflict(true);
            setSavedLocally(false);
            break;
          }
          if (pendingAppearanceSaveRef.current) {
            continue;
          }
          setSavedLocally(false);
          toast.error(copy.saveFailed);
          break;
        }
      }
    } finally {
      appearanceSaveInFlightRef.current = false;
      setIsSaving(false);
    }
  }, [copy.saveFailed, copy.saveNotDurable, updateDraft]);

  const orderedPosts = useMemo(() => {
    const rank = new Map(draft.postOrder.map((id, index) => [id, index]));
    return [...posts].sort((left, right) => {
      const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    });
  }, [draft.postOrder, posts]);

  const handleSortableReorder = useCallback(
    (_newItems: AnnouncementRow[], newKeys: string[]) => {
      const next = {
        ...draft,
        // `newKeys` only covers the rows this page loaded, so writing it
        // straight to postOrder would unpin every post beyond that window.
        postOrder: applyPageOrder(draft.postOrder, newKeys),
      };
      updateDraft(next);
      broadcastSiteAppearance(next);
      void persist(next);
    },
    [draft, persist, updateDraft],
  );

  const preview = draft.hero[locale];
  const fallbackHero = messages.home;

  if (isAuthLoading || isLoggingOut || !canAccess) {
    return <LoadingState label={copy.title} className="m-8" />;
  }

  return (
    <AdminFrame
      title={copy.title}
      description={copy.description}
      eyebrow={copy.eyebrow}
      actions={
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            role="status"
            aria-live="polite"
            title={savedLocally ? copy.saveNotDurable : undefined}
            className={cn(
              'inline-flex min-h-11 items-center rounded-md border px-3',
              isSaving
                ? 'border-border'
                : savedLocally
                  ? 'border-amber-500/60 text-amber-600'
                  : 'border-portal-chrome-accent text-foreground',
            )}
          >
            {isSaving ? copy.saving : savedLocally ? copy.savedLocal : copy.saved}
          </span>
          <LinkButton href="/admin/announcements" variant="outline">
            {copy.openAnnouncements}
          </LinkButton>
        </div>
      }
    >
      {error ? (
        <ErrorState title={copy.loadFailed} description={error} onRetry={() => void load()} />
      ) : isLoading ? (
        <LoadingState label={copy.title} />
      ) : (
        <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0 space-y-8">
            {staleConflict ? (
              <div
                role="alert"
                className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm text-foreground"
              >
                <p>{copy.staleVersion}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  disabled={isSaving}
                  onClick={() => void load()}
                >
                  {copy.reload}
                </Button>
              </div>
            ) : null}
            <section className="min-w-0 space-y-4 rounded-xl border border-border/80 bg-card p-4 shadow-xs sm:p-5">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-foreground">{copy.heroTitle}</h2>
                <div className="grid w-full grid-cols-2 rounded-md border border-border/80 p-1 sm:inline-flex sm:w-auto" role="tablist">
                  {(['en', 'vi'] as const).map((item, index) => (
                    <button
                      key={item}
                      ref={copyLocaleTabs.tabRef(item)}
                      type="button"
                      role="tab"
                      aria-selected={copyLocale === item}
                      tabIndex={copyLocaleTabs.tabIndex(item)}
                      onKeyDown={(event) => copyLocaleTabs.onKeyDown(event, index)}
                      onClick={() => setCopyLocale(item)}
                      className={cn(
                        'min-h-11 rounded-sm px-3 text-sm font-semibold',
                        copyLocale === item
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {item === 'en' ? copy.localeEn : copy.localeVi}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{copy.heroHint}</p>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">{copy.heroEyebrow}</span>
                <Input
                  value={draft.hero[copyLocale].eyebrow}
                  onChange={(event) => {
                    updateDraft((current) => ({
                      ...current,
                      hero: {
                        ...current.hero,
                        [copyLocale]: {
                          ...current.hero[copyLocale],
                          eyebrow: event.target.value,
                        },
                      },
                    }));
                  }}
                  onBlur={(event) => {
                    const next = {
                      ...draft,
                      hero: {
                        ...draft.hero,
                        [copyLocale]: {
                          ...draft.hero[copyLocale],
                          eyebrow: event.target.value,
                        },
                      },
                    };
                    updateDraft(next);
                    void persist(next);
                  }}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">{copy.heroTitle}</span>
                <Input
                  value={draft.hero[copyLocale].title}
                  onChange={(event) => {
                    updateDraft((current) => ({
                      ...current,
                      hero: {
                        ...current.hero,
                        [copyLocale]: {
                          ...current.hero[copyLocale],
                          title: event.target.value,
                        },
                      },
                    }));
                  }}
                  onBlur={(event) => {
                    const next = {
                      ...draft,
                      hero: {
                        ...draft.hero,
                        [copyLocale]: {
                          ...draft.hero[copyLocale],
                          title: event.target.value,
                        },
                      },
                    };
                    updateDraft(next);
                    void persist(next);
                  }}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">{copy.heroImage}</span>
                <Input
                  value={draft.hero.image}
                  placeholder="/hero-campus.jpg"
                  onChange={(event) => {
                    updateDraft((current) => ({
                      ...current,
                      hero: { ...current.hero, image: event.target.value },
                    }));
                  }}
                  onBlur={(event) => {
                    const next = {
                      ...draft,
                      hero: { ...draft.hero, image: event.target.value },
                    };
                    updateDraft(next);
                    void persist(next);
                  }}
                />
                <p className="text-xs text-muted-foreground">{copy.heroImageHint}</p>
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">{copy.heroDescription}</span>
                <Textarea
                  value={draft.hero[copyLocale].description}
                  onChange={(event) => {
                    updateDraft((current) => ({
                      ...current,
                      hero: {
                        ...current.hero,
                        [copyLocale]: {
                          ...current.hero[copyLocale],
                          description: event.target.value,
                        },
                      },
                    }));
                  }}
                  onBlur={(event) => {
                    const next = {
                      ...draft,
                      hero: {
                        ...draft.hero,
                        [copyLocale]: {
                          ...draft.hero[copyLocale],
                          description: event.target.value,
                        },
                      },
                    };
                    updateDraft(next);
                    void persist(next);
                  }}
                />
              </label>
            </section>

            <section className="min-w-0 space-y-4 rounded-xl border border-border/80 bg-card p-4 shadow-xs sm:p-5">
              <h2 className="text-lg font-semibold text-foreground">{copy.accent}</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {SITE_APPEARANCE_ACCENTS.map((accent) => (
                  <button
                    key={accent}
                    type="button"
                    disabled={isSaving}
                    onClick={() => {
                      const next = { ...draft, accent };
                      updateDraft(next);
                      broadcastSiteAppearance(next);
                      void persist(next);
                    }}
                    className={cn(
                      'min-h-11 rounded-md border px-3 py-3 text-left text-sm font-semibold',
                      draft.accent === accent
                        ? 'border-portal-chrome-accent bg-secondary'
                        : 'border-border/80 hover:border-foreground/30',
                    )}
                    aria-pressed={draft.accent === accent}
                  >
                    {copy.accents[accent as SiteAppearanceAccent]}
                  </button>
                ))}
              </div>
            </section>

            <section className="min-w-0 space-y-4 rounded-xl border border-border/80 bg-card p-4 shadow-xs sm:p-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{copy.postsTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{copy.postsDescription}</p>
              </div>
              {postsLoadFailed ? (
                <ErrorState
                  title={copy.loadFailed}
                  description={copy.postsLoadFailed}
                  onRetry={() => void load()}
                />
              ) : orderedPosts.length === 0 ? (
                <EmptyState
                  icon={Palette}
                  title={copy.postsEmpty}
                  description={copy.postsDescription}
                  action={
                    <LinkButton href="/admin/announcements">{copy.openAnnouncements}</LinkButton>
                  }
                />
              ) : (
                <SortableList
                  tag="ol"
                  items={orderedPosts}
                  disabled={isSaving}
                  keyExtractor={(post) => post.id}
                  onOrderChange={handleSortableReorder}
                  className="min-w-0 divide-y divide-border border-y border-border"
                  itemClassName="transition-colors hover:bg-muted/30"
                  renderItem={(post, index) => (
                    <div className="flex items-center gap-2 py-3">
                      <DragHandle
                        className="shrink-0 cursor-grab"
                        label={copy.dragToReorder}
                        title={copy.dragToReorder}
                      />
                      <span className="w-8 text-sm font-semibold tabular-nums text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={post.title}>
                        {post.title}
                      </span>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={copy.moveUp}
                          disabled={isSaving || index === 0}
                          onClick={() => {
                            const next = {
                              ...draft,
                              postOrder: movePostOrder(draft.postOrder, post.id, -1),
                            };
                            updateDraft(next);
                            broadcastSiteAppearance(next);
                            void persist(next);
                          }}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={copy.moveDown}
                          disabled={isSaving || index === orderedPosts.length - 1}
                          onClick={() => {
                            const next = {
                              ...draft,
                              postOrder: movePostOrder(draft.postOrder, post.id, 1),
                            };
                            updateDraft(next);
                            broadcastSiteAppearance(next);
                            void persist(next);
                          }}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                />
              )}
            </section>
          </div>

          <aside className="min-w-0 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {copy.preview}
            </h2>
            <div className="rounded-lg border-l-4 border-portal-chrome-accent bg-portal-sidebar p-6 text-portal-sidebar-text">
              <p className="text-xs font-semibold uppercase tracking-wide text-portal-chrome-accent">
                {preview.eyebrow || fallbackHero.eyebrow}
              </p>
              <p className="mt-4 text-2xl font-semibold leading-8">
                {preview.title || fallbackHero.title}
              </p>
              <p className="mt-3 text-sm leading-6 text-portal-sidebar-muted">
                {preview.description || fallbackHero.description}
              </p>
              <p className="mt-6 text-xs text-portal-sidebar-muted">{copy.live}</p>
            </div>
          </aside>
        </div>
      )}
    </AdminFrame>
  );
}
