'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Code2,
  Copy,
  Download,
  Eye,
  FileEdit,
  FileText,
  GripVertical,
  ImageIcon,
  Layers,
  ListOrdered,
  Megaphone,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Sliders,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRequireAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n';
import { editorSurfacesEn, editorSurfacesVi } from '@/i18n/messages-editor';
import { announcementsApi, type AnnouncementRecord } from '@/lib/api';
import { AnnouncementReaderModal } from '@/components/announcements/AnnouncementReaderModal';
import {
  AnnouncementEditModal,
  EDIT_BANNER_PRESETS,
} from '@/components/announcements/AnnouncementEditModal';
import {
  DEFAULT_SITE_APPEARANCE,
  SITE_APPEARANCE_ACCENTS,
  applyPageOrder,
  orderByIds,
  type SiteAppearance,
  type SiteAppearanceAccent,
} from '@/lib/site-appearance';
import {
  broadcastSiteAppearance,
  fetchSiteAppearance,
  saveSiteAppearance,
} from '@/lib/site-appearance-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { LoadingState } from '@/components/ui/state-block';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { TinyMceEditor, clearTinyMceAutosaveDrafts } from '@/components/ui/tinymce-editor';
import { SortableList, DragHandle } from '@/components/ui/sortable-list';
import {
  UnsavedChangesConfirmDialog,
} from '@/components/ui/unsaved-changes-confirm';
import {
  announcementLengthViolationMessage,
  findAnnouncementLengthViolation,
} from '@/lib/announcement-limits';
import { announcementPriorityLabel } from '@/lib/announcement-presentation';
import { useUnsavedChangesGuard } from '@/lib/use-unsaved-changes-guard';
import { replaceCoverBlock, removeCoverBlock } from '@/lib/cover-banner';
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { countLabel } from '@/lib/plural';
import { cn } from '@/lib/utils';
import {
  buildDocumentFilename,
  parseStoredEditorDocument,
  shouldSeedDefaultEditorDocument,
  type StoredEditorDocument,
} from '@/lib/editor-document';
import {
  EDITOR_BLOCK_TYPES,
  EDITOR_SEED_HTML,
  EDITOR_SEED_MARKDOWN,
  EDITOR_TEMPLATE_IDS,
  getEditorBlockHtml,
  getEditorTemplateHtml,
  type EditorBlockType,
  type EditorTemplateId,
} from '@/lib/editor-templates';

export interface ContentBlock {
  id: string;
  type: 'header' | 'recipient' | 'summary' | 'table' | 'clauses' | 'notice' | 'signoff';
  title: string;
  description: string;
  enabled: boolean;
  htmlContent: string;
}

interface EditorBlockCopy {
  title: string;
  description: string;
}

/**
 * The block list is metadata (titles/descriptions) from the `editor.blocks`
 * messages plus the shared HTML bodies from lib/editor-templates.ts.
 */
function buildDefaultBlocks(
  copy: Record<EditorBlockType, EditorBlockCopy>,
  isVi: boolean,
): ContentBlock[] {
  return EDITOR_BLOCK_TYPES.map((type) => ({
    id: `block-${type}`,
    type,
    title: copy[type].title,
    description: copy[type].description,
    enabled: true,
    htmlContent: getEditorBlockHtml(type, isVi),
  }));
}

const PRIORITY_VALUES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'] as const;
const TARGET_ROLE_VALUES = ['ALL', 'BOTH', 'STUDENT', 'LECTURER'] as const;

type TargetRoleOption = (typeof TARGET_ROLE_VALUES)[number];

/**
 * Maps the composer's audience choice onto the stored announcement audience.
 * `BOTH` is a targeted STUDENT+LECTURER audience, distinct from `ALL`
 * (isGlobal campus-wide): collapsing the two made editing a role-scoped
 * notice silently turn it into a campus-wide one and add ADMIN to it.
 */
function audienceFor(role: TargetRoleOption) {
  if (role === 'ALL') return { isGlobal: true, targetRoles: ['STUDENT', 'LECTURER', 'ADMIN'] };
  if (role === 'BOTH') return { isGlobal: false, targetRoles: ['STUDENT', 'LECTURER'] };
  return { isGlobal: false, targetRoles: [role] };
}

const STORAGE_KEY_PREFIX = 'campuscore_editor_document';
const EDITOR_TYPE_KEY_PREFIX = 'campuscore_editor_engine';
export default function AcademicEditorPageGate() {
  const { user, hasAccess, isLoading: authLoading, isForbidden } = useRequireAuth([
    'ADMIN',
    'SUPER_ADMIN',
  ]);
  const { locale } = useI18n();
  const copy = locale === 'vi' ? editorSurfacesVi.studio : editorSurfacesEn.studio;
  // Every draft surface below is keyed to this resolved account id, so no
  // editor may mount — and no storage may be read or written — before an
  // authorized administrator identity actually exists.
  const draftOwnerId =
    !authLoading && !isForbidden && hasAccess ? (user?.id ?? null) : null;

  if (authLoading) {
    return <LoadingState label={copy.loading} />;
  }

  // Strict Admin Gate: Only Admins can access!
  if (isForbidden || !hasAccess) {
    return <WorkspaceForbiddenState signedIn={Boolean(user)} />;
  }

  if (!draftOwnerId) {
    return <LoadingState label={copy.loading} />;
  }

  // Remounting per owner is the isolation boundary: a different
  // administrator can never inherit the previous session's draft fields,
  // deferred hydration or in-flight edit context.
  return <AcademicEditorPage key={draftOwnerId} draftOwnerId={draftOwnerId} />;
}

function AcademicEditorPage({ draftOwnerId }: { draftOwnerId: string }) {
  const { user, hasAccess, isLoading: authLoading, isForbidden } = useRequireAuth([
    'ADMIN',
    'SUPER_ADMIN',
  ]);
  const { locale, formatDate, messages } = useI18n();
  // Draft persistence is namespaced per account: another administrator's
  // draft and engine choice are unreachable from this session, and unattributed
  // keys written before namespacing stay quarantined rather than adopted.
  const STORAGE_KEY = `${STORAGE_KEY_PREFIX}:${encodeURIComponent(draftOwnerId)}`;
  const EDITOR_TYPE_KEY = `${EDITOR_TYPE_KEY_PREFIX}:${encodeURIComponent(draftOwnerId)}`;
  const isVi = locale === 'vi';
  const copy = isVi ? editorSurfacesVi.studio : editorSurfacesEn.studio;
  const templateLabels = isVi ? editorSurfacesVi.templates.library : editorSurfacesEn.templates.library;
  const editorCopy = messages.editor;
  // Author fallback for drafts and previews with no publisher: the English
  // workspace must not print a Vietnamese office name.
  const fallbackPublisher = copy.authorFallback;

  // Navigation tab state: 'announcement' (Editor) | 'hero' (Site Controls) | 'templates' (Document Library)
  const [activeTab, setActiveTab] = useState<'announcement' | 'hero' | 'templates'>('announcement');

  // Editor states
  const [editorType, setEditorType] = useState<'tinymce' | 'markdown'>('tinymce');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('notice');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'URGENT' | 'HIGH' | 'NORMAL' | 'LOW'>('NORMAL');
  const [targetRole, setTargetRole] = useState<TargetRoleOption>('ALL');
  const [priorityKnown, setPriorityKnown] = useState(true);
  const [audienceKnown, setAudienceKnown] = useState(true);
  const [isPublishingNotice, setIsPublishingNotice] = useState(false);
  const publishInFlightRef = useRef(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState<number>(0);
  const [publishedNotices, setPublishedNotices] = useState<AnnouncementRecord[]>([]);
  const [loadingNotices, setLoadingNotices] = useState(false);
  // An API outage must not read as an empty database: the honest error state
  // stops an author from re-publishing a "missing" notice as a duplicate.
  const [noticesLoadError, setNoticesLoadError] = useState(false);
  const [previewingNotice, setPreviewingNotice] = useState<AnnouncementRecord | null>(null);
  // A toast here expires and is routinely missed, so a deep link that failed to
  // resolve has to stay on the page until the author acknowledges it.
  const [deepLinkNotice, setDeepLinkNotice] = useState<{
    targetId: string;
    reason: 'not-found' | 'load-failed';
  } | null>(null);
  const [editingNoticeModal, setEditingNoticeModal] = useState<AnnouncementRecord | null>(null);
  const studioEditorRef = useRef<{ id: string } | null>(null);

  // RT-P3-3: unsaved-changes guard (beforeunload + in-app confirm) shared with
  // the other editors via lib/use-unsaved-changes-guard.ts. A document is
  // dirty once the author typed a title or moved the body off the template.
  const defaultBodyFor = useCallback(
    () =>
      editorType === 'tinymce'
        ? (isVi ? EDITOR_SEED_HTML.vi : EDITOR_SEED_HTML.en)
        : EDITOR_SEED_MARKDOWN,
    [editorType, isVi],
  );
  const unsaved = useUnsavedChangesGuard({
    isDirty: useCallback(
      () => title.trim() !== '' || content !== defaultBodyFor(),
      [title, content, defaultBodyFor],
    ),
    enabled: !isPublishingNotice,
    interceptRouteChanges: true,
  });

  // Sortable Content Blocks Builder State. Block labels come from the local
  // editor fragment; bilingual HTML bodies stay in lib/editor-templates.ts.
  const [showBlockBuilder, setShowBlockBuilder] = useState(true);
  const defaultBlocks = useMemo(
    () => buildDefaultBlocks(copy.blocks, isVi),
    [copy.blocks, isVi],
  );
  const [blocks, setBlocks] = useState<ContentBlock[]>(defaultBlocks);
  const [hasUnsavedNoticeOrder, setHasUnsavedNoticeOrder] = useState(false);
  // F-2: the order save runs a site-appearance PUT plus one PUT per dragged
  // row; without an in-flight lock a double click re-runs the whole chain.
  const [isSavingNoticeOrder, setIsSavingNoticeOrder] = useState(false);
  // The pinned-notices list is a `tbody` SortableList, which cannot carry its own
  // live region, so the page keeps the sentence here and renders it below.
  const [noticeMove, setNoticeMove] = useState('');

  // Site Appearance (Hero / Banner control)
  const [siteAppearance, setSiteAppearance] = useState<SiteAppearance>(DEFAULT_SITE_APPEARANCE);
  const [heroEyebrow, setHeroEyebrow] = useState(() => editorCopy.heroEyebrowDefault);
  const [heroTitle, setHeroTitle] = useState(() => editorCopy.heroTitleDefault);
  const [heroDescription, setHeroDescription] = useState(() => editorCopy.heroDescriptionDefault);
  const [heroAccent, setHeroAccent] = useState<SiteAppearanceAccent>('ute-yellow');
  const [isSavingHero, setIsSavingHero] = useState(false);
  // The publish button must stay disabled until a real fetch hydrates the
  // fields — otherwise a failed load would push the built-in defaults over
  // the live site configuration.
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [appearanceLoadFailed, setAppearanceLoadFailed] = useState(false);

  // Studio labels come from the directly imported editorSurfaces fragment.

  // Initialize from storage or default exactly once. The locale must never
  // reseed this editor afterwards: an in-progress edit (a loaded announcement)
  // or a hydrated draft would be wiped, and a subsequent save would overwrite
  // a live record with the blank template.
  const seedLocaleRef = useRef(isVi);
  const editingIdRef = useRef(editingId);
  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  useEffect(() => {
    try {
      const savedEngine = localStorage.getItem(EDITOR_TYPE_KEY) as 'tinymce' | 'markdown' | null;
      if (savedEngine === 'tinymce' || savedEngine === 'markdown') {
        setEditorType(savedEngine);
      }

      const parsed = parseStoredEditorDocument(localStorage.getItem(STORAGE_KEY));
      if (parsed) {
        setTitle(parsed.title);
        setCategory(parsed.category);
        setContent(parsed.content);
        setLastSaved(parsed.updatedAt || null);
        if (parsed.editorType) {
          setEditorType(parsed.editorType);
        }
        // K1: a draft saved while a saved announcement was open has to restore
        // that edit context too. Without it a reload left editingId null and
        // "Publish" silently created a duplicate of the record being updated;
        // the amber editing banner keys off this state as well.
        if (parsed.editingId) {
          setEditingId(parsed.editingId);
          setEditingVersion(parsed.editingVersion ?? 0);
          // Legacy edit drafts did not store these fields. Omit unknown
          // metadata on PATCH instead of silently widening the live notice.
          setPriorityKnown(Boolean(parsed.priority));
          setAudienceKnown(Boolean(parsed.targetRole));
        }
        if (parsed.priority) setPriority(parsed.priority);
        if (parsed.targetRole) setTargetRole(parsed.targetRole);
        return;
      }
    } catch {
      // Storage can be unavailable (private mode); fall through to seeding.
    }

    if (!shouldSeedDefaultEditorDocument({ hasStoredDraft: false, editingId: editingIdRef.current })) {
      return;
    }
    // The seed is frozen at mount locale (seedLocaleRef) so a later locale
    // switch never reseeds over an in-progress edit or a hydrated draft.
    setTitle(
      seedLocaleRef.current
        ? editorSurfacesVi.studio.seedTitle
        : editorSurfacesEn.studio.seedTitle,
    );
    setContent(seedLocaleRef.current ? EDITOR_SEED_HTML.vi : EDITOR_SEED_HTML.en);
  }, [STORAGE_KEY, EDITOR_TYPE_KEY]);

  // Load site appearance for Hero control tab
  useEffect(() => {
    let cancelled = false;
    setAppearanceReady(false);
    setAppearanceLoadFailed(false);
    fetchSiteAppearance()
      .then((data) => {
        if (cancelled) return;
        setSiteAppearance(data);
        const heroData = data.hero[locale] || data.hero.vi;
        if (heroData.eyebrow) setHeroEyebrow(heroData.eyebrow);
        if (heroData.title) setHeroTitle(heroData.title);
        if (heroData.description) setHeroDescription(heroData.description);
        if (data.accent) setHeroAccent(data.accent);
        setAppearanceReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setAppearanceReady(false);
          setAppearanceLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const handleSwitchEditorType = (type: 'tinymce' | 'markdown') => {
    setEditorType(type);
    try {
      localStorage.setItem(EDITOR_TYPE_KEY, type);
    } catch {
      // ignore
    }
  };

  const saveDraft = useCallback(() => {
    // Stamp drafts in the UI locale — the browser default can differ (e.g.
    // en-US AM/PM shown to a vi-VN reader).
    const timestamp = new Date().toLocaleTimeString(isVi ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const payload: StoredEditorDocument = {
      title,
      category,
      content,
      editorType,
      updatedAt: timestamp,
      // K1: the draft carries the edit context, so hydrating it can resume the
      // update of a saved announcement instead of losing that association.
      editingId,
      editingVersion,
      priority: priorityKnown ? priority : undefined,
      targetRole: audienceKnown ? targetRole : undefined,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setLastSaved(timestamp);
      toast.success(copy.savedToast);
    } catch {
      // Quota errors (large inline images) used to fail with zero feedback,
      // so the author believed a draft existed that did not.
      toast.error(copy.draftSaveFailed);
    }
  }, [audienceKnown, category, content, copy.draftSaveFailed, copy.savedToast, STORAGE_KEY, editingId, editingVersion, editorType, isVi, priority, priorityKnown, targetRole, title]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success(copy.copiedToast);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(copy.copyFailed);
    }
  }, [content, copy.copiedToast, copy.copyFailed]);

  const handleDownload = useCallback(() => {
    const isHtml = editorType === 'tinymce';
    const ext = isHtml ? 'html' : 'md';
    const mime = isHtml ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8';
    // K2: Unicode-aware slug shared with the TinyMCE shell export, so both
    // download buttons produce the same name for the same title.
    const filename = buildDocumentFilename(title, ext);

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content, editorType, title]);

  /**
   * Drop the localStorage draft + TinyMCE autosave without touching live
   * editor state. Called after a successful create/update so a later reload
   * cannot hydrate a pre-publish body and stale editingVersion.
   */
  const clearPersistedDraft = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    clearTinyMceAutosaveDrafts(studioEditorRef.current?.id);
  }, [STORAGE_KEY]);

  const handleReset = useCallback(() => {
    // RT-P3-3: routed through the unsaved-changes guard so the confirm text
    // and the beforeunload protection come from one mechanism.
    unsaved.requestLeave(() => {
      // K1: "New Document" is the create-new flow, so it must also leave the
      // edit context — otherwise Publish would overwrite the record that was
      // open before the reset.
      setEditingId(null);
      setEditingVersion(0);
      setPriorityKnown(true);
      setAudienceKnown(true);
      setTitle('');
      setContent(defaultBodyFor());
      setLastSaved(null);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      // K6: a discarded document must not be resurrected from TinyMCE's own
      // autosave draft.
      clearTinyMceAutosaveDrafts(studioEditorRef.current?.id);
    });
  }, [defaultBodyFor, STORAGE_KEY, unsaved]);

  // Reorder content blocks via SortableJS
  const handleReorderBlocks = (newBlocks: ContentBlock[]) => {
    setBlocks(newBlocks);
  };

  // Toggle single block inclusion
  const handleToggleBlock = (id: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b))
    );
  };

  // Compile all enabled blocks into TinyMCE
  const handleCompileBlocksToTinyMce = () => {
    const active = blocks.filter((b) => b.enabled);
    if (active.length === 0) {
      toast.error(copy.notifications.blocksRequired);
      return;
    }
    const compiled = `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">\n${active.map((b) => b.htmlContent).join('\n\n')}\n</div>`;
    // Compiling replaces the whole draft (title untouched but the body is
    // rewritten), so it goes through the same unsaved-changes guard as New
    // Document and Cancel — a one-click replace must not bypass the prompt.
    unsaved.requestLeave(() => {
      setContent(compiled);
      toast.success(countLabel(active.length, copy.notifications.blocksAppliedOne, copy.notifications.blocksApplied).replace('{count}', String(active.length)));
    });
  };

  // Insert a single block into TinyMCE
  const handleInsertSingleBlock = (block: ContentBlock) => {
    setContent((prev) => `${prev}\n\n${block.htmlContent}`);
    toast.success(copy.notifications.blockInserted.replace('{title}', block.title));
  };

  // Reset blocks to default order
  const handleResetBlocks = () => {
    setBlocks(defaultBlocks);
    toast.info(copy.notifications.blocksReset);
  };

  // Active cover image detection from content
  const activeCoverUrl =
    EDIT_BANNER_PRESETS.find((b) => content.includes(b.url))?.url ||
    content.match(/src=["'](\/images\/(?:banners|news)\/[^"']+)["']/i)?.[1] ||
    null;

  const handleApplyBanner = (bannerUrl: string, bannerTitle: string) => {
    const figureMarkup = `<figure class="my-3 text-center">\n  <img src="${bannerUrl}" alt="${bannerTitle}" class="w-full rounded-lg object-cover max-h-72 shadow-xs" />\n  <figcaption class="mt-1.5 text-xs text-muted-foreground italic">${bannerTitle}</figcaption>\n</figure>\n\n`;

    // Splice only the block that owns the active cover URL — a document may
    // hold ordinary figures (inline screenshots) before the banner.
    const replaced = activeCoverUrl
      ? replaceCoverBlock(content, activeCoverUrl, figureMarkup)
      : null;
    setContent(replaced ?? figureMarkup + content);
    toast.success(
      replaced !== null
        ? copy.notifications.bannerChanged.replace('{title}', bannerTitle)
        : copy.notifications.bannerAdded.replace('{title}', bannerTitle),
    );
  };

  const handleRemoveBanner = () => {
    if (!activeCoverUrl) return;
    const removed = removeCoverBlock(content, activeCoverUrl);
    if (removed !== null) {
      setContent(removed);
    }
    toast.info(copy.notifications.bannerRemoved);
  };

  // Reorder announcements via SortableJS
  const handleSortableNoticeReorder = (newNotices: AnnouncementRecord[]) => {
    setPublishedNotices(newNotices);
    setHasUnsavedNoticeOrder(true);
  };

  // Save announcements order to site appearance & Spring Boot backend
  const handleSaveNoticeOrder = async () => {
    // F-2: the header button is rendered with animate-pulse while the order is
    // unsaved, which invites the double click that used to re-run the whole
    // PUT chain. One run at a time, and both triggers reflect it.
    if (isSavingNoticeOrder) return;
    setIsSavingNoticeOrder(true);
    try {
      // Merge onto the freshest remote appearance so a stale mount-time copy
      // (or another admin's concurrent edit) is not clobbered by this PUT.
      const fresh = await fetchSiteAppearance();
      const newOrder = publishedNotices.map((n) => n.id);
      const updated: SiteAppearance = {
        ...fresh,
        // Only the loaded notices are reordered here; applying the order to that
        // subset keeps pins set for announcements outside this batch.
        postOrder: applyPageOrder(fresh.postOrder, newOrder),
      };
      const saved = await saveSiteAppearance(updated);
      broadcastSiteAppearance(updated);
      setSiteAppearance(saved);

      // This list is page 1 of fifteen published notices, so writing 0..14 would
      // re-seat every announcement outside the window as if it were the global
      // order. The dragged rows therefore swap the ranks they already occupy.
      // `displayOrder` is nullable by design (V70): a rank-less notice sorts
      // after the pinned ones, so it stays out of the swap instead of being
      // handed a number — and never an out-of-range one, since the column is a
      // 32-bit INTEGER.
      const ranked = publishedNotices.filter((n) => typeof n.displayOrder === 'number');
      const rankless = publishedNotices.length - ranked.length;
      const slots = ranked
        .map((n) => n.displayOrder as number)
        .sort((left, right) => left - right);
      const settled = await Promise.allSettled(
        ranked.map((n, index) => announcementsApi.updateDisplayOrder(n.id, slots[index])),
      );
      const failed = settled.filter((outcome) => outcome.status === 'rejected').length;
      if (failed > 0) {
        // The pins are saved but the server order is not, so reload from the
        // server rather than leave a success notice over a half-applied order.
        void fetchPublishedNotices();
        toast.error(
          copy.noticeOrder.partialFailure
            .replace('{failed}', String(failed))
            .replace('{total}', String(ranked.length)),
        );
        return;
      }

      setHasUnsavedNoticeOrder(false);
      if (ranked.length === 0) {
        // Nothing here carried a rank, so no server write could express the drag
        // at all; the pins are saved but the feed order is unchanged.
        toast.warning(copy.noticeOrder.noRank);
      } else if (rankless > 0) {
        toast.info(
          copy.noticeOrder.rankless
            .replace('{ranked}', String(ranked.length))
            .replace('{unranked}', String(rankless)),
        );
      }
      if (saved.persisted === false) {
        toast.warning(copy.noticeOrder.localOnly);
      } else {
        toast.success(copy.noticeOrder.saved);
      }
    } catch {
      toast.error(copy.noticeOrder.saveFailed);
      void fetchPublishedNotices();
    } finally {
      setIsSavingNoticeOrder(false);
    }
  };

  // Fetch published announcements from campus database
  const fetchPublishedNotices = useCallback(async () => {
    setLoadingNotices(true);
    try {
      // The card is the live feed order: drafts and review copies must not be
      // dragged into the published page order.
      const res = await announcementsApi.getAll({ page: 1, limit: 15, status: 'PUBLISHED' });
      const raw = res.data || [];
      const ordered = siteAppearance.postOrder?.length > 0 ? orderByIds(raw, siteAppearance.postOrder) : raw;
      setPublishedNotices(ordered);
      setHasUnsavedNoticeOrder(false);
      setNoticesLoadError(false);
    } catch {
      setNoticesLoadError(true);
    } finally {
      setLoadingNotices(false);
    }
  }, [siteAppearance.postOrder]);

  useEffect(() => {
    if (hasAccess) {
      void fetchPublishedNotices();
    }
  }, [fetchPublishedNotices, hasAccess]);

  // Save modal edit changes directly
  const handleSaveModalEdit = async (id: string, payload: any) => {
    // The modal edits content through a plain textarea, making it a third authoring
    // surface. Gating only the publish and update buttons left this path able to
    // send an oversized body and receive the same opaque 400.
    const modalOverflow = findAnnouncementLengthViolation(String(payload?.content ?? ''));
    if (modalOverflow) {
      toast.error(announcementLengthViolationMessage(modalOverflow, locale));
      return;
    }
    const updated = await announcementsApi.update(id, payload);
    toast.success(copy.notifications.noticeUpdated);
    setPublishedNotices((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...updated, ...payload } : n))
    );
  };

  // Load existing announcement into TinyMCE editor
  const handleLoadAnnouncement = useCallback((ann: AnnouncementRecord) => {
    setEditingId(ann.id);
    setEditingVersion(ann.version ?? 0);
    setPriorityKnown(true);
    setAudienceKnown(true);
    setTitle(ann.title);
    setContent(ann.content);
    if (ann.priority === 'URGENT' || ann.priority === 'HIGH' || ann.priority === 'NORMAL' || ann.priority === 'LOW') {
      setPriority(ann.priority as any);
    }
    if (ann.isGlobal || !ann.targetRoles || ann.targetRoles.length === 0) {
      setTargetRole('ALL');
    } else if (
      ann.targetRoles.includes('STUDENT') &&
      ann.targetRoles.includes('LECTURER')
    ) {
      // Targeted at both roles without being campus-wide: keep that state
      // distinct so saving the studio edit does not silently globalize it.
      setTargetRole('BOTH');
    } else if (ann.targetRoles.includes('STUDENT')) {
      setTargetRole('STUDENT');
    } else if (ann.targetRoles.includes('LECTURER')) {
      setTargetRole('LECTURER');
    } else {
      setTargetRole('ALL');
    }
    setEditorType('tinymce');
    setActiveTab('announcement');
    setTimeout(() => {
      const workspaceEl = document.getElementById('editor-workspace');
      if (workspaceEl) {
        workspaceEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
    toast.success(copy.notifications.editStarted.replace('{title}', ann.title.slice(0, 32)));
  }, [copy]);

  // Auto load announcement from query param ?editId=... or ?id=...
  // Runs once per mount: the effect keyed on isVi re-fired on every language
  // toggle and refetched the record over an in-progress edit, resetting the
  // draft to server values with no unsaved-changes prompt.
  // The guard arms only when a fetch RESOLVES: arming before the request
  // dead-locked the deep link under React StrictMode's mount→cleanup→remount
  // (run 1 armed and was cancelled, run 2 saw the armed ref and returned).
  const deepLinkLoadedRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (deepLinkLoadedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get('editId') || params.get('id');
    if (!targetId) return;

    let cancelled = false;
    const markLoaded = () => {
      deepLinkLoadedRef.current = true;
    };
    announcementsApi
      .getById(targetId)
      .then((found) => {
        if (cancelled) return;
        markLoaded();
        if (found) {
          setDeepLinkNotice(null);
          handleLoadAnnouncement(found);
        } else {
          // The editor would otherwise show its blank seed document; the
          // author must know the requested draft was not loaded.
          setDeepLinkNotice({ targetId, reason: 'not-found' });
          toast.error(copy.notices.notFound.replace('{id}', targetId));
        }
      })
      .catch(() => {
        if (!cancelled) {
          markLoaded();
          setDeepLinkNotice({ targetId, reason: 'load-failed' });
          toast.error(copy.notices.loadFailed);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [copy, handleLoadAnnouncement]);

  // Preview current draft in Official Administrative modal
  const handlePreviewCurrentDraft = () => {
    const authorName = user
      ? (`${user.lastName || ''} ${user.firstName || ''}`.trim() || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email)
      : copy.publisherFallback;
    setPreviewingNotice({
      id: editingId || 'draft-preview',
      title: title || copy.notices.previewTitle,
      content: content,
      priority: priority,
      createdAt: new Date().toISOString(),
      publishAt: new Date().toISOString(),
      publishedBy: authorName,
      ...audienceFor(targetRole),
    });
  };

  // Cancel edit mode and start new
  const handleCancelEdit = () => {
    // RT-P3-3: the announcement being edited is lost on cancel, so the same
    // unsaved-changes guard protects it.
    unsaved.requestLeave(() => {
      setEditingId(null);
      setEditingVersion(0);
      setPriorityKnown(true);
      setAudienceKnown(true);
      setTitle('');
      setContent(defaultBodyFor());
      try {
        // K1: the stored draft holds the edit context; cancelling the edit has
        // to drop it as well, or the next reload restores the edit the author
        // just left. K6: also drop the TinyMCE autosave draft.
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      clearTinyMceAutosaveDrafts(studioEditorRef.current?.id);
      toast.info(copy.notifications.editCancelled);
    });
  };

  // Publish announcement to backend feed
  const handlePublishAnnouncement = async () => {
    if (publishInFlightRef.current || isPublishingNotice) return;
    // K1: when a saved announcement is open in the editor, "Publish" means
    // "save this document". It must update the live record instead of pushing a
    // duplicate of it; the create-new flow is reached by cancelling the edit or
    // starting a new document, both of which clear editingId.
    if (editingId) {
      await handleUpdateAnnouncement();
      return;
    }
    if (!title.trim()) {
      toast.error(copy.notifications.titleRequired);
      return;
    }
    // Gate before the request. Letting an oversized body reach the server returns an
    // opaque 400 and leaves the author with no idea what to change, which is the
    // dead-end the content limits exist to prevent.
    const publishOverflow = findAnnouncementLengthViolation(content);
    if (publishOverflow) {
      toast.error(announcementLengthViolationMessage(publishOverflow, locale));
      return;
    }

    publishInFlightRef.current = true;
    setIsPublishingNotice(true);
    try {
      const created = await announcementsApi.create({
        title,
        content,
        priority,
        targetYears: [],
        ...audienceFor(targetRole),
      });

      // Creating stores the caller as the author, and the review step refuses
      // the author, so a fresh draft can only be queued for review here. The
      // server's returned status is the only evidence a success toast may report.
      const submitted = created.status === 'DRAFT'
        ? await announcementsApi.submit(created.id)
        : created;

      // A published document must not resurrect from the persisted draft —
      // reloading used to hydrate the pre-publish body and re-Publish wrote a
      // duplicate (or conflicted on a stale expectedVersion for edits).
      clearPersistedDraft();
      if (submitted.status === 'PUBLISHED') {
        toast.success(copy.notifications.announcementPublished);
      } else {
        toast.success(messages.content.lifecycle.submitted);
      }
      void fetchPublishedNotices();
    } catch (err) {
      toast.error(copy.notifications.announcementSubmitFailed);
    } finally {
      publishInFlightRef.current = false;
      setIsPublishingNotice(false);
    }
  };

  // Update existing announcement in backend
  const handleUpdateAnnouncement = async () => {
    if (publishInFlightRef.current || isPublishingNotice) return;
    if (!editingId || !title.trim()) {
      toast.error(copy.notifications.postTitleRequired);
      return;
    }
    // Same gate as publish: an update that exceeds the cap fails identically.
    const updateOverflow = findAnnouncementLengthViolation(content);
    if (updateOverflow) {
      toast.error(announcementLengthViolationMessage(updateOverflow, locale));
      return;
    }

    publishInFlightRef.current = true;
    setIsPublishingNotice(true);
    try {
      await announcementsApi.update(editingId, {
        title,
        content,
        ...(priorityKnown ? { priority } : {}),
        ...(audienceKnown ? audienceFor(targetRole) : {}),
        reason: copy.notifications.updateReason,
        expectedVersion: editingVersion,
      });

      setEditingVersion((prev) => prev + 1);
      // Same rule as publish: the saved draft mirrors the just-written state,
      // so the persisted copy is dropped to keep reloads from reopening a
      // stale editingVersion (which the next update then 409s on).
      clearPersistedDraft();
      toast.success(copy.notifications.announcementUpdated);
      void fetchPublishedNotices();
    } catch {
      toast.error(copy.notifications.announcementUpdateFailed);
    } finally {
      publishInFlightRef.current = false;
      setIsPublishingNotice(false);
    }
  };

  // Publish Hero banner changes to site appearance
  const handlePublishHero = async () => {
    setIsSavingHero(true);
    try {
      const updated: SiteAppearance = {
        ...siteAppearance,
        accent: heroAccent,
        hero: {
          ...siteAppearance.hero,
          [locale]: {
            eyebrow: heroEyebrow,
            title: heroTitle,
            description: heroDescription,
          },
        },
      };

      const saved = await saveSiteAppearance(updated);
      broadcastSiteAppearance(updated);
      setSiteAppearance(saved);
      if (saved.persisted === false) {
        // The hero block lives on the API row; this instance only is not
        // "published live", and saying so is the difference between an admin
        // leaving the page believing the banner changed everywhere and it
        // disappearing on the next deploy.
        toast.warning(copy.appearance.saveLocalWarning);
      } else {
        toast.success(copy.appearance.published);
      }
    } catch {
      toast.error(copy.appearance.saveFailed);
    } finally {
      setIsSavingHero(false);
    }
  };

  // Load selected template into editor
  const applyTemplate = (templateContent: string, templateTitle: string) => {
    // Loading a template replaces the entire draft — behind the same
    // unsaved-changes guard as every other destructive action on this page,
    // so an author with a long in-progress document gets the confirm dialog.
    unsaved.requestLeave(() => {
      setContent(templateContent);
      setTitle(templateTitle);
      setActiveTab('announcement');
      toast.success(copy.notifications.templateApplied);
    });
  };

  const stats = useMemo(() => {
    const cleanText = editorType === 'tinymce'
      ? content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      : content.trim();
    const chars = cleanText.length;
    const words = cleanText.length === 0 ? 0 : cleanText.split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.ceil(words / 200));
    return { chars, words, minutes };
  }, [content, editorType]);

  if (authLoading) {
    return <LoadingState label={copy.loading} />;
  }

  // Strict Admin Gate: Only Admins can access!
  if (isForbidden || !hasAccess) {
    return <WorkspaceForbiddenState signedIn={Boolean(user)} />;
  }

  const deepLinkCopy = deepLinkNotice
    ? deepLinkNotice.reason === 'not-found'
      ? copy.notices.notFound.replace('{id}', deepLinkNotice.targetId)
      : copy.notices.deepLinkLoadFailed.replace('{id}', deepLinkNotice.targetId)
    : null;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
        title={copy.title}
        description={copy.description}
      />

      {deepLinkCopy ? (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-status-danger-foreground"
        >
          <span>{deepLinkCopy}</span>
          <button
            type="button"
            onClick={() => setDeepLinkNotice(null)}
            aria-label={copy.dismissDeepLinkWarning}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-status-danger-foreground transition-colors hover:bg-destructive/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* Main Tab Controller */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 pb-3">
        <Button
          type="button"
          variant={activeTab === 'announcement' ? 'default' : 'outline'}
          onClick={() => setActiveTab('announcement')}
          className="gap-2 font-semibold"
        >
          <FileEdit className="h-4 w-4" />
          {copy.tabs.announcement}
        </Button>
        <Button
          type="button"
          variant={activeTab === 'hero' ? 'default' : 'outline'}
          onClick={() => setActiveTab('hero')}
          className="gap-2 font-semibold"
        >
          <Sliders className="h-4 w-4" />
          {copy.tabs.hero}
        </Button>
        <Button
          type="button"
          variant={activeTab === 'templates' ? 'default' : 'outline'}
          onClick={() => setActiveTab('templates')}
          className="gap-2 font-semibold"
        >
          <BookOpen className="h-4 w-4" />
          {copy.tabs.templates}
        </Button>
      </div>

      {/* TAB 1: HERO & SITE APPEARANCE CONTROL */}
      {activeTab === 'hero' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sliders className="h-5 w-5 text-primary" />
                {editorCopy.heroCardTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <label htmlFor="hero-eyebrow-input" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {editorCopy.heroEyebrowLabel}
                </label>
                <Input
                  id="hero-eyebrow-input"
                  value={heroEyebrow}
                  onChange={(e) => setHeroEyebrow(e.target.value)}
                  placeholder={editorCopy.heroEyebrowDefault}
                  className="font-bold text-primary"
                />
              </div>

              <div>
                <label htmlFor="hero-title-input" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {editorCopy.heroTitleLabel}
                </label>
                <Input
                  id="hero-title-input"
                  value={heroTitle}
                  onChange={(e) => setHeroTitle(e.target.value)}
                  placeholder={editorCopy.heroTitleDefault}
                  className="font-semibold"
                />
              </div>

              <div>
                <label htmlFor="hero-description-input" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {editorCopy.heroDescriptionLabel}
                </label>
                <Textarea
                  id="hero-description-input"
                  value={heroDescription}
                  onChange={(e) => setHeroDescription(e.target.value)}
                  rows={3}
                  className="leading-relaxed"
                />
              </div>

              <div>
                <p
                  id="hero-accent-label"
                  className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {editorCopy.heroAccentLabel}
                </p>
                <div className="flex flex-wrap gap-3" role="group" aria-labelledby="hero-accent-label">
                  {SITE_APPEARANCE_ACCENTS.map((accent) => (
                    <button
                      key={accent}
                      type="button"
                      aria-pressed={heroAccent === accent}
                      onClick={() => setHeroAccent(accent)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
                        heroAccent === accent
                          ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/20'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      <Palette className="h-3.5 w-3.5" />
                      <span>{accent}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Preview Box */}
              <div className="rounded-xl border border-border/80 bg-muted/30 p-5">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                  {editorCopy.heroLivePreview}
                </div>
                <div className="border-l-4 border-portal-chrome-accent pl-5 py-2 space-y-2">
                  <SectionEyebrow>{heroEyebrow}</SectionEyebrow>
                  {/* Preview mirrors the published hero markup visually but is
                      not the document's heading — PageHeader owns the real h1. */}
                  <p className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                    {heroTitle}
                  </p>
                  <p className="text-sm text-foreground/80 max-w-xl">
                    {heroDescription}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                {!appearanceReady && (
                  <p className="text-xs text-muted-foreground">
                    {appearanceLoadFailed
                      ? copy.appearance.loadFailed
                      : copy.appearance.loading}
                  </p>
                )}
                <Button
                  type="button"
                  onClick={handlePublishHero}
                  disabled={isSavingHero || !appearanceReady}
                  className="gap-2 bg-primary text-primary-foreground font-semibold px-6 shadow-sm"
                >
                  <Save className="h-4 w-4" />
                  {isSavingHero ? editorCopy.heroPublishing : editorCopy.heroPublish}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: ANNOUNCEMENT & DOCUMENT WYSIWYG EDITOR */}
      {activeTab === 'announcement' && (
        <div id="editor-workspace" className="space-y-5">
          <Card>
            <CardContent className="p-4 sm:p-5">
              {editingId && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200">
                  <div className="flex items-center gap-2 font-medium">
                    <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>
                      {editorCopy.editingBanner.replace('{title}', title || editingId)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelEdit}
                    className="h-7 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                  >
                    {editorCopy.cancelEdit}
                  </Button>
                </div>
              )}

              {/* Row 1: Document Metadata Configuration (Full-Width Responsive Grid) */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12 items-end">
                <div className="sm:col-span-2 lg:col-span-6">
                  <label htmlFor="editor-doc-title" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">
                    {copy.docTitleLabel}
                  </label>
                  <Input
                    id="editor-doc-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={copy.docTitlePlaceholder}
                    className="font-medium h-10 w-full"
                  />
                </div>
                <div className="sm:col-span-1 lg:col-span-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">
                    {copy.priorityLabel}
                  </p>
                  <Select
                    aria-label={copy.priorityLabel}
                    value={editingId && !priorityKnown ? '' : priority}
                    onChange={(e) => {
                      setPriority(e.target.value as (typeof PRIORITY_VALUES)[number]);
                      setPriorityKnown(true);
                    }}
                    options={[...(editingId && !priorityKnown ? [{ value: '', label: copy.keepSavedPriority }] : []), ...PRIORITY_VALUES.map((value) => ({
                      value,
                      label: editorCopy.priorityOptions[value],
                    }))]}
                    className="h-10"
                  />
                </div>
                <div className="sm:col-span-1 lg:col-span-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">
                    {copy.targetRoleLabel}
                  </p>
                  <Select
                    aria-label={copy.targetRoleLabel}
                    value={editingId && !audienceKnown ? '' : targetRole}
                    onChange={(e) => {
                      setTargetRole(e.target.value as (typeof TARGET_ROLE_VALUES)[number]);
                      setAudienceKnown(true);
                    }}
                    options={[...(editingId && !audienceKnown ? [{ value: '', label: copy.keepSavedAudience }] : []), ...TARGET_ROLE_VALUES.map((value) => ({
                      value,
                      label: editorCopy.targetRoleOptions[value],
                    }))]}
                    className="h-10"
                  />
                </div>
              </div>

              {/* Row 2: Dedicated Action Toolbar */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePreviewCurrentDraft}
                    className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                    title={editorCopy.previewActionTitle}
                  >
                    <Eye className="h-4 w-4" />
                    {editorCopy.previewAction}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="gap-1.5"
                  >
                    {copied ? <Check className="h-4 w-4 text-status-success-foreground" /> : <Copy className="h-4 w-4" />}
                    {copy.copyContent}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDownload}
                    className="gap-1.5"
                  >
                    <Download className="h-4 w-4" />
                    {editorType === 'tinymce' ? editorCopy.exportHtml : editorCopy.exportMarkdown}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={saveDraft}
                    className="gap-1.5"
                  >
                    <FileText className="h-4 w-4" />
                    {copy.saveDraft}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {editingId ? (
                    <Button
                      type="button"
                      onClick={handleUpdateAnnouncement}
                      disabled={isPublishingNotice}
                      size="sm"
                      className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs"
                      title={editorCopy.saveChangesTitle}
                    >
                      <Save className="h-4 w-4" />
                      {isPublishingNotice ? editorCopy.saving : editorCopy.saveChanges}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    onClick={handlePublishAnnouncement}
                    disabled={isPublishingNotice}
                    size="sm"
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-800 text-white font-semibold shadow-xs"
                    title={editingId ? editorCopy.publishChangesTitle : undefined}
                  >
                    <Send className="h-4 w-4" />
                    {isPublishingNotice
                      ? editorCopy.publishing
                      : editingId
                      ? editorCopy.publishChanges
                      : messages.content.lifecycle.actions.submit}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleReset}
                    className="gap-1.5 text-muted-foreground hover:text-destructive"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {copy.newDoc}
                  </Button>
                </div>
              </div>

              {/* Engine Selector & Statistics Bar */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-1">
                  <button
                    type="button"
                    onClick={() => handleSwitchEditorType('tinymce')}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
                      editorType === 'tinymce'
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{copy.tinymceMode}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchEditorType('markdown')}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
                      editorType === 'markdown'
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    <span>{copy.markdownMode}</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <FileEdit className="h-3.5 w-3.5 text-primary" />
                    <strong>{stats.words.toLocaleString(isVi ? 'vi-VN' : 'en-US')}</strong> {copy.words}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5 text-primary" />
                    <strong>{stats.chars.toLocaleString(isVi ? 'vi-VN' : 'en-US')}</strong> {copy.characters}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-primary" />
                    ~<strong>{stats.minutes}</strong> {copy.minutes} {copy.readingTime}
                  </span>
                  {lastSaved && (
                    <>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                        {copy.savedAt}: <strong>{lastSaved}</strong>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sortable Content Blocks Builder Toggle & Workspace */}
          <Card className="border-border/80 shadow-xs">
            <CardHeader className="py-3 px-4 border-b border-border/60 bg-muted/20">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                      <span>{editorCopy.blockBuilderTitle}</span>
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {editorCopy.blockBuilderBadge}
                      </span>
                    </CardTitle>
                    <p className="text-[11.5px] text-muted-foreground">
                      {editorCopy.blockBuilderHint}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={showBlockBuilder ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setShowBlockBuilder(!showBlockBuilder)}
                    className="h-8 gap-1.5 text-xs font-semibold"
                  >
                    <ListOrdered className="h-3.5 w-3.5" />
                    <span>
                      {showBlockBuilder ? editorCopy.collapseBlocks : editorCopy.openBlocks}
                    </span>
                    {showBlockBuilder ? (
                      <ChevronUp className="h-3.5 w-3.5 ml-0.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {showBlockBuilder && (
              <CardContent className="p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span>
                      {editorCopy.blockDragHint}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleResetBlocks}
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      {editorCopy.resetBlocks}
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={handleCompileBlocksToTinyMce}
                      className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-800 text-white text-xs font-semibold shadow-xs"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {editorCopy.insertAllBlocks}
                    </Button>
                  </div>
                </div>

                <SortableList<ContentBlock>
                  tag="div"
                  itemTag="div"
                  items={blocks}
                  keyExtractor={(b) => b.id}
                  onOrderChange={handleReorderBlocks}
                  className="space-y-2.5"
                  renderItem={(block, index) => (
                    <div
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors',
                        block.enabled
                          ? 'border-border bg-card shadow-xs'
                          : 'border-dashed border-border/60 bg-muted/30 opacity-60'
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <DragHandle
                          className="cursor-grab hover:text-primary active:cursor-grabbing"
                          label={editorCopy.dragHandleLabel}
                          title={editorCopy.dragHandleLabel}
                        />
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <input
                          type="checkbox"
                          checked={block.enabled}
                          onChange={() => handleToggleBlock(block.id)}
                          className="h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer"
                          aria-label={editorCopy.toggleBlockTitle}
                          title={editorCopy.toggleBlockTitle}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">
                            {block.title}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {block.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleInsertSingleBlock(block)}
                          className="h-6 px-2 text-[11px] font-medium"
                          title={editorCopy.appendBlockTitle}
                        >
                          <Plus className="h-3 w-3 mr-0.5" />
                          {editorCopy.appendBlock}
                        </Button>
                      </div>
                    </div>
                  )}
                />
              </CardContent>
            )}
          </Card>

          {/* Editorial Cover Banner Gallery (Stitch Screen a3c5abce08fb4069a3b2b1d7dd7aaea4) */}
          <Card className="border-border/80 shadow-xs">
            <CardHeader className="py-2.5 px-4 border-b border-border/60 bg-muted/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ImageIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-xs font-bold text-foreground flex items-center gap-2">
                      <span>{editorCopy.coverGalleryTitle}</span>
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        8K Nano Banana
                      </span>
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground">
                      {editorCopy.coverGalleryHint}
                    </p>
                  </div>
                </div>
                {activeCoverUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveBanner}
                    className="h-7 text-xs font-medium text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    {editorCopy.removeBanner}
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {EDIT_BANNER_PRESETS.map((banner) => {
                  const isSelected = activeCoverUrl === banner.url;
                  const bannerTitle = isVi ? banner.titleVi : banner.titleEn;
                  const bannerTag = isVi ? banner.tagVi : banner.tagEn;
                  return (
                    <button
                      key={banner.id}
                      type="button"
                      onClick={() => handleApplyBanner(banner.url, bannerTitle)}
                      className={cn(
                        'group relative flex flex-col overflow-hidden rounded-lg border text-left transition-all duration-150',
                        isSelected
                          ? 'border-primary ring-2 ring-primary/40 shadow-xs'
                          : 'border-border/70 bg-card hover:border-primary/50'
                      )}
                    >
                      <div className="relative h-14 w-full overflow-hidden bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={banner.url}
                          alt={bannerTitle}
                          width={banner.width}
                          height={banner.height}
                          className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-105"
                        />
                        {isSelected ? (
                          <div className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground shadow-xs">
                            <Check className="h-3 w-3" />
                          </div>
                        ) : null}
                      </div>
                      <div className="p-1.5 bg-card">
                        <p className="text-[11px] font-semibold text-foreground truncate" title={bannerTitle}>
                          {bannerTitle}
                        </p>
                        <span className="text-[11px] text-muted-foreground">{bannerTag}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Editor Workspace */}
          <div className="rounded-xl border border-border/80 bg-card p-1 shadow-sm sm:p-2">
            {editorType === 'tinymce' ? (
              <TinyMceEditor
                id="studio"
                draftOwnerId={draftOwnerId}
                value={content}
                onChange={setContent}
                onInit={(_event, editor) => { studioEditorRef.current = editor; }}
                height={580}
                locale={isVi ? 'vi' : 'en'}
                showTemplates={true}
                documentTitle={title}
              />
            ) : (
              <RichTextEditor
                value={content}
                onChange={setContent}
                minHeight="540px"
                locale={isVi ? 'vi' : 'en'}
                showTemplates={true}
              />
            )}
          </div>

          {/* Section: Live Announcements Database & One-Click Load into TinyMCE */}
          <Card className="mt-6 border-border/80 shadow-xs">
            <CardHeader className="border-b border-border/60 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                    <Megaphone className="h-4 w-4 text-primary" />
                    {copy.noticeOrder.title}
                    <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-300 border border-blue-500/20">
                      {copy.noticeOrder.customOrder}
                    </span>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {copy.noticeOrder.hint}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {hasUnsavedNoticeOrder && (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={handleSaveNoticeOrder}
                      disabled={isSavingNoticeOrder}
                      className="h-8 gap-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs animate-pulse disabled:animate-none"
                    >
                      {isSavingNoticeOrder ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {isSavingNoticeOrder
                          ? editorCopy.saving
                          : copy.noticeOrder.saveButton}
                      </span>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={fetchPublishedNotices}
                    disabled={loadingNotices}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', loadingNotices && 'animate-spin')} />
                    <span>{copy.noticeOrder.refresh}</span>
                  </Button>
                </div>
              </div>
            </CardHeader>

            {hasUnsavedNoticeOrder && (
              <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-blue-700 dark:text-blue-300">
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="h-4 w-4 shrink-0 text-status-info-foreground" />
                  <span>
                    {copy.noticeOrder.unsavedHint}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveNoticeOrder}
                  disabled={isSavingNoticeOrder}
                  className="h-7 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold shrink-0 shadow-xs"
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {isSavingNoticeOrder ? editorCopy.saving : copy.noticeOrder.saveNow}
                </Button>
              </div>
            )}

            <CardContent className="p-0">
              {loadingNotices ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                    <span>{copy.noticeOrder.loading}</span>
                  </div>
                </div>
              ) : noticesLoadError ? (
                <div className="py-8 text-center text-xs text-destructive">
                  <p>{copy.noticeOrder.loadFailed}</p>
                  <button
                    type="button"
                    className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                    onClick={() => void fetchPublishedNotices()}
                  >
                    {copy.noticeOrder.retry}
                  </button>
                </div>
              ) : publishedNotices.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {copy.noticeOrder.empty}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <p aria-live="polite" role="status" className="sr-only">
                    {noticeMove}
                  </p>
                  <table className="w-full min-w-[920px] text-left text-xs border-collapse">
                    <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground font-semibold">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">#</th>
                        <th className="py-2.5 px-3 w-14 text-center">{copy.noticeOrder.pin}</th>
                        <th className="py-2.5 px-4 min-w-[200px]">{copy.noticeOrder.titleColumn}</th>
                        <th className="py-2.5 px-3 w-24 whitespace-nowrap">{copy.noticeOrder.priorityColumn}</th>
                        <th className="py-2.5 px-3 w-28 whitespace-nowrap">{copy.noticeOrder.audienceColumn}</th>
                        <th className="py-2.5 px-3 max-w-[160px] truncate">{copy.noticeOrder.publisherColumn}</th>
                        <th className="py-2.5 px-3 w-24 whitespace-nowrap">{copy.noticeOrder.dateColumn}</th>
                        <th className="sticky right-0 z-20 bg-muted/95 backdrop-blur-xs py-2.5 px-4 min-w-[190px] text-right shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.08)]">{copy.noticeOrder.actionsColumn}</th>
                      </tr>
                    </thead>
                    <SortableList<AnnouncementRecord>
                      tag="tbody"
                      itemTag="tr"
                      items={publishedNotices}
                      keyExtractor={(ann) => ann.id}
                      onOrderChange={handleSortableNoticeReorder}
                      announceMove={({ item, from, to, total }) => {
                        const message = copy.noticeOrder.moved
                          .replace('{title}', item.title)
                          .replace('{from}', String(from + 1))
                          .replace('{to}', String(to + 1))
                          .replace('{total}', String(total));
                        setNoticeMove(message);
                        return message;
                      }}
                      itemClassName="hover:bg-muted/30 transition-colors border-b border-border/50"
                      renderItem={(ann, index) => (
                        <>
                          <td className="py-3 px-3 text-center">
                            <DragHandle
                              className="mx-auto cursor-grab hover:text-primary active:cursor-grabbing"
                              label={copy.noticeOrder.dragLabel}
                              title={copy.noticeOrder.dragLabel}
                            />
                          </td>
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <span
                              className={cn(
                                'inline-flex items-center justify-center rounded px-1.5 py-0.5 font-bold text-[11px]',
                                index === 0
                                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              {index === 0 ? copy.noticeOrder.topRank : `#${index + 1}`}
                            </span>
                          </td>
                          <td className="py-3 px-4 min-w-[200px] max-w-sm">
                            <div className="font-semibold text-foreground line-clamp-2">
                              {ann.title}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                              {ann.isGlobal
                                ? copy.noticeOrder.campusScope
                                : copy.noticeOrder.targetedScope}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={cn(
                                'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold',
                                ann.priority === 'URGENT'
                                  ? 'bg-red-500/10 text-red-600 dark:text-red-300 border border-red-500/30'
                                  : ann.priority === 'HIGH'
                                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                                  : 'bg-blue-500/10 text-blue-600 dark:text-blue-300 border border-blue-500/30'
                              )}
                            >
                              {announcementPriorityLabel(ann.priority, locale)}
                            </span>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className="inline-flex items-center rounded bg-secondary/80 px-2 py-0.5 text-[11px] font-medium text-foreground">
                              {ann.isGlobal
                                ? copy.noticeOrder.allAudience
                                : ann.targetRoles?.includes('STUDENT')
                                ? copy.noticeOrder.studentsAudience
                                : copy.noticeOrder.lecturersAudience}
                            </span>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-muted-foreground text-[11.5px] max-w-[160px] truncate" title={ann.publishedBy || fallbackPublisher}>
                            {ann.publishedBy || fallbackPublisher}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-muted-foreground text-[11.5px]">
                            {ann.createdAt ? formatDate(ann.createdAt) : '—'}
                          </td>
                          <td className="sticky right-0 z-10 bg-card/95 backdrop-blur-xs py-3 px-4 min-w-[190px] text-right whitespace-nowrap shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.08)]">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setPreviewingNotice(ann)}
                                className="h-7 px-2.5 text-[11.5px] gap-1 hover:bg-primary/10 hover:text-primary"
                                title={copy.noticeOrder.previewTitle}
                              >
                                <Eye className="h-3.5 w-3.5 text-primary" />
                                <span>{copy.noticeOrder.preview}</span>
                              </Button>
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                onClick={() => setEditingNoticeModal(ann)}
                                className="h-7 px-2.5 text-[11.5px] gap-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs"
                                title={copy.noticeOrder.editTitle}
                              >
                                <FileEdit className="h-3.5 w-3.5" />
                                <span>{copy.noticeOrder.edit}</span>
                              </Button>
                            </div>
                          </td>
                        </>
                      )}
                    />
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 3: TEMPLATES REPOSITORY. Labels come from the editor fragment;
          bilingual HTML bodies stay in lib/editor-templates.ts. */}
      {activeTab === 'templates' && (
        <div className="grid gap-5 md:grid-cols-2">
          {EDITOR_TEMPLATE_IDS.map((templateId) => {
            const templateCopy = templateLabels[templateId];
            return (
              <Card key={templateId} className="flex flex-col justify-between hover:border-primary/50 transition-colors">
                <CardHeader>
                  <CardTitle className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary" />
                    {templateCopy.title}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {templateCopy.description}
                  </p>
                </CardHeader>
                <CardContent className="pt-2 flex justify-end gap-2 border-t border-border/50">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => applyTemplate(getEditorTemplateHtml(templateId, isVi), templateCopy.title)}
                    className="gap-1.5 text-xs font-semibold"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {editorCopy.loadIntoEditor}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Official Administrative Reader Modal */}
      {previewingNotice && (
        <AnnouncementReaderModal
          announcement={previewingNotice}
          isOpen={Boolean(previewingNotice)}
          onClose={() => setPreviewingNotice(null)}
          onEdit={(notice) => {
            setPreviewingNotice(null);
            setEditingNoticeModal(notice);
          }}
        />
      )}

      {/* In-Place Administrative Edit Modal */}
      {editingNoticeModal && (
        <AnnouncementEditModal
          announcement={editingNoticeModal}
          isOpen={Boolean(editingNoticeModal)}
          onClose={() => {
            setEditingNoticeModal(null);
          }}
          onSave={handleSaveModalEdit}
          onOpenStudio={(notice) => {
            setEditingNoticeModal(null);
            handleLoadAnnouncement(notice);
          }}
        />
      )}

      {/* RT-P3-3: unsaved-changes confirm for destructive in-page actions */}
      <UnsavedChangesConfirmDialog
        open={unsaved.confirmOpen}
        title={editorCopy.unsavedTitle}
        description={editorCopy.unsavedDescription}
        confirmLabel={editorCopy.unsavedConfirm}
        cancelLabel={editorCopy.unsavedKeep}
        onConfirm={unsaved.confirmLeave}
        onCancel={unsaved.cancelLeave}
      />
    </div>
  );
}
