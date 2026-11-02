'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  Eye,
  FileEdit,
  Globe,
  GraduationCap,
  ImageIcon,
  Loader2,
  Save,
  School,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import type { AnnouncementMutation, AnnouncementRecord } from '@/lib/api';
import {
  announcementLengthViolationMessage,
  findAnnouncementLengthViolation,
} from '@/lib/announcement-limits';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/i18n';
import { RichContentRenderer } from '@/components/ui/rich-content-renderer';
import { TinyMceEditor, clearTinyMceAutosaveDrafts } from '@/components/ui/tinymce-editor';
import { replaceCoverBlock, removeCoverBlock } from '@/lib/cover-banner';
import { cn } from '@/lib/utils';
import {
  announcementWorkspaceEn,
  announcementWorkspaceVi,
} from '@/i18n/messages-announcements';

type CoverId = keyof typeof announcementWorkspaceEn.covers;

/**
 * `EDIT_BANNER_PRESETS` is also consumed by the site-editor banner tray
 * (`app/dashboard/editor/page.tsx`, another package). These locale projections
 * keep that call site compiling while the copy itself lives only in the
 * announcement workspace catalogue.
 */
function coverCopy(id: CoverId) {
  return {
    titleVi: announcementWorkspaceVi.covers[id].title,
    titleEn: announcementWorkspaceEn.covers[id].title,
    tagVi: announcementWorkspaceVi.covers[id].tag,
    tagEn: announcementWorkspaceEn.covers[id].tag,
  };
}

export const EDIT_BANNER_PRESETS = [
  {
    id: 'campus',
    url: '/images/banners/campus_academic_banner.jpg',
    width: 1376,
    height: 768,
    ...coverCopy('campus'),
  },
  {
    id: 'notice',
    url: '/images/banners/academic_notice_banner.jpg',
    width: 1376,
    height: 768,
    ...coverCopy('notice'),
  },
  {
    id: 'thesis',
    url: '/images/banners/thesis_defense_hall.jpg',
    width: 1376,
    height: 768,
    ...coverCopy('thesis'),
  },
  {
    id: 'council',
    url: '/images/banners/thesis_evaluation_council.jpg',
    width: 2172,
    height: 724,
    ...coverCopy('council'),
  },
  {
    id: 'faculty',
    url: '/images/banners/faculty_engineering_hall.jpg',
    width: 1376,
    height: 768,
    ...coverCopy('faculty'),
  },
  {
    id: 'library',
    url: '/images/banners/smart_campus_library.jpg',
    width: 1376,
    height: 768,
    ...coverCopy('library'),
  },
  {
    id: 'convocation',
    url: '/images/banners/academic_convocation_ceremony.jpg',
    width: 1376,
    height: 768,
    ...coverCopy('convocation'),
  },
  {
    id: 'lab',
    url: '/images/banners/department_research_lab.jpg',
    width: 1376,
    height: 768,
    ...coverCopy('lab'),
  },
] as const;

interface AnnouncementEditModalProps {
  announcement: AnnouncementRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, payload: AnnouncementMutation) => Promise<void>;
  onOpenStudio?: (announcement: AnnouncementRecord) => void;
}

export function AnnouncementEditModal({
  announcement,
  isOpen,
  onClose,
  onSave,
  onOpenStudio,
}: AnnouncementEditModalProps) {
  const { locale } = useI18n();
  const workspaceCopy = { en: announcementWorkspaceEn, vi: announcementWorkspaceVi }[locale];
  const copy = workspaceCopy.composer;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'URGENT' | 'HIGH' | 'NORMAL' | 'LOW'>('NORMAL');
  // `BOTH` is a targeted STUDENT+LECTURER audience, distinct from `ALL`
  // (isGlobal campus-wide). Collapsing the two made a quick save flip
  // isGlobal to true on a notice that was deliberately role-scoped.
  const [targetRole, setTargetRole] = useState<'ALL' | 'BOTH' | 'STUDENT' | 'LECTURER'>('ALL');
  const [publishedBy, setPublishedBy] = useState('');
  const [editorMode, setEditorMode] = useState<'visual' | 'code' | 'preview'>('visual');
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState('');
  const modalEditorRef = useRef<{ id: string } | null>(null);
  const handleClose = () => {
    clearTinyMceAutosaveDrafts(modalEditorRef.current?.id);
    onClose();
  };

  // Active cover image detection from content
  const activeCoverUrl =
    EDIT_BANNER_PRESETS.find((b) => content.includes(b.url))?.url ||
    content.match(/src=["'](\/images\/(?:banners|news)\/[^"']+)["']/i)?.[1] ||
    null;

  const handleApplyBanner = (banner: (typeof EDIT_BANNER_PRESETS)[number], bannerTitle: string) => {
    const figureMarkup = `<figure class="my-3 text-center">\n  <img src="${banner.url}" alt="${bannerTitle}" width="${banner.width}" height="${banner.height}" class="w-full rounded-lg object-cover max-h-72 shadow-xs" />\n  <figcaption class="mt-1.5 text-xs text-muted-foreground italic">${bannerTitle}</figcaption>\n</figure>\n\n`;

    if (activeCoverUrl) {
      // Splice only the block carrying the active cover URL; the old spanning
      // regex could start at an earlier figure and delete everything between.
      const replaced = replaceCoverBlock(content, activeCoverUrl, figureMarkup);
      if (replaced !== null) {
        setContent(replaced);
        return;
      }
    }
    setContent((prev) => figureMarkup + prev);
  };

  const handleRemoveBanner = () => {
    if (!activeCoverUrl) return;
    const removed = removeCoverBlock(content, activeCoverUrl);
    if (removed !== null) {
      setContent(removed);
    }
  };

  useEffect(() => {
    if (!announcement) return;

    setTitle(announcement.title || '');
    setContent(announcement.content || '');
    setPriority((announcement.priority as any) || 'NORMAL');
    setPublishedBy(announcement.publishedBy || '');

    if (announcement.isGlobal || !announcement.targetRoles || announcement.targetRoles.length === 0) {
      setTargetRole('ALL');
    } else if (
      announcement.targetRoles.includes('STUDENT') &&
      announcement.targetRoles.includes('LECTURER')
    ) {
      // Targeted at both roles without being campus-wide: keep that state
      // distinct so saving the quick edit does not silently globalize it.
      setTargetRole('BOTH');
    } else if (announcement.targetRoles.includes('STUDENT')) {
      setTargetRole('STUDENT');
    } else if (announcement.targetRoles.includes('LECTURER')) {
      setTargetRole('LECTURER');
    }

    setEditorMode('visual');
    setValidationError('');
  }, [announcement]);

  if (!announcement) return null;

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setValidationError(copy.validationTitle);
      return;
    }
    if (!content.trim()) {
      setValidationError(copy.validationContent);
      return;
    }

    const overflow = findAnnouncementLengthViolation(content);
    if (overflow) {
      setValidationError(
        announcementLengthViolationMessage(overflow, locale),
      );
      return;
    }

    setValidationError('');
    setIsSaving(true);
    try {
      const isGlobal = targetRole === 'ALL';
      const targetRoles =
        targetRole === 'ALL' || targetRole === 'BOTH'
          ? ['STUDENT', 'LECTURER']
          : [targetRole];

      const payload: AnnouncementMutation = {
        title: title.trim(),
        content: content.trim(),
        priority,
        isGlobal,
        targetRoles,
        // The quick-edit form shows none of these, but the full editor always
        // sends them — so an omitted field is rewritten, not left alone. A
        // quick save that dropped them silently unbound the semester/section/
        // lecturer, cleared the year filter and wiped the publish/expiry
        // window. Carry each untouched field through unchanged.
        semesterId: announcement.semesterId,
        sectionId: announcement.sectionId,
        lecturerId: announcement.lecturerId,
        targetYears: announcement.targetYears,
        publishAt: announcement.publishAt,
        expiresAt: announcement.expiresAt,
        expectedVersion: announcement.version ?? 0,
        reason: copy.quickEditReason,
      };

      await onSave(announcement.id, payload);
      handleClose();
    } catch (err: any) {
      setValidationError(
        err?.response?.data?.message || copy.saveFailed
      );
    } finally {
      setIsSaving(false);
    }
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={copy.title}
      className="max-w-3xl"
    >
      <form onSubmit={handleFormSubmit} className="space-y-4">
        {validationError ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs font-medium text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{validationError}</span>
          </div>
        ) : null}

        {/* Header Notice Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/40 px-3.5 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">
              {copy.noticeId}
            </span>
            <code className="font-mono text-[11px] text-muted-foreground">
              {announcement.id.slice(0, 12)}...
            </code>
          </div>
          <div className="min-w-0 text-right text-[11px] text-muted-foreground">
            {copy.publishedBy}{' '}
            <span className="font-medium text-foreground">
              {publishedBy || copy.defaultPublisher}
            </span>
          </div>
        </div>

        {/* Title Input */}
        <div>
          <label htmlFor="announcement-edit-title" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {copy.titleLabel} <span className="text-destructive">*</span>
          </label>
          <Input
            id="announcement-edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={copy.titlePlaceholder}
            className="font-medium h-9 text-sm"
            required
          />
        </div>

        {/* Metadata Controls: Priority & Target Role */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="announcement-edit-priority"
              className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {copy.priorityLabel}
            </label>
            <select
              id="announcement-edit-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="URGENT">{copy.priority.URGENT}</option>
              <option value="HIGH">{copy.priority.HIGH}</option>
              <option value="NORMAL">{copy.priority.NORMAL}</option>
              <option value="LOW">{copy.priority.LOW}</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="announcement-edit-target-role"
              className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {copy.audienceLabel}
            </label>
            <select
              id="announcement-edit-target-role"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value as any)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="ALL">{copy.audience.ALL}</option>
              <option value="BOTH">{copy.audience.BOTH}</option>
              <option value="STUDENT">{copy.audience.STUDENT}</option>
              <option value="LECTURER">{copy.audience.LECTURER}</option>
            </select>
          </div>
        </div>

        {/* Editorial Cover Image Preset Tray */}
        <div className="space-y-2 rounded-lg border border-border/70 bg-secondary/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-primary" />
              {copy.coverLabel}
            </label>
            {activeCoverUrl ? (
              <button
                type="button"
                onClick={handleRemoveBanner}
                className="shrink-0 text-[11px] font-medium text-destructive hover:underline flex items-center gap-1 cursor-pointer"
              >
                <X className="h-3 w-3" />
                {copy.removeCover}
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {EDIT_BANNER_PRESETS.map((banner) => {
              const isSelected = activeCoverUrl === banner.url;
              const cover = workspaceCopy.covers[banner.id];
              const bannerTitle = cover.title;
              const bannerTag = cover.tag;
              return (
                <button
                  key={banner.id}
                  type="button"
                  onClick={() => handleApplyBanner(banner, bannerTitle)}
                  className={cn(
                    'group relative flex flex-col overflow-hidden rounded-lg border text-left transition-all duration-150',
                    isSelected
                      ? 'border-primary ring-2 ring-primary/40 shadow-xs'
                      : 'border-border/70 bg-card hover:border-primary/50'
                  )}
                >
                  <div className="relative h-16 w-full overflow-hidden bg-muted">
                    <picture className="absolute inset-0 block h-full w-full">
                      <source
                        srcSet={banner.url.replace(/\.jpg$/i, '.webp')}
                        type="image/webp"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={banner.url}
                        alt={bannerTitle}
                        width={banner.width}
                        height={banner.height}
                        className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-105"
                      />
                    </picture>
                    {isSelected ? (
                      <div className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-primary-foreground shadow-xs">
                        <Check className="h-3 w-3" />
                      </div>
                    ) : null}
                  </div>
                  <div className="p-1.5 bg-card">
                    <p className="text-[11px] font-semibold text-foreground truncate" title={bannerTitle}>{bannerTitle}</p>
                    <span className="text-[11px] text-muted-foreground">{bannerTag}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content Area with 3-Mode Toggle: Visual (TinyMCE) vs Code vs Preview */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {copy.contentLabel} <span className="text-destructive">*</span>
            </label>
            <div className="flex items-center gap-1 rounded-md border border-border/80 bg-background p-0.5 text-xs [&_button]:whitespace-nowrap">
              <button
                type="button"
                onClick={() => setEditorMode('visual')}
                className={cn(
                  'flex items-center gap-1 rounded px-2 py-1 font-medium transition',
                  editorMode === 'visual'
                    ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {copy.modes.visual}
              </button>
              <button
                type="button"
                onClick={() => setEditorMode('code')}
                className={cn(
                  'flex items-center gap-1 rounded px-2 py-1 font-medium transition',
                  editorMode === 'code'
                    ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <FileEdit className="h-3.5 w-3.5" />
                {copy.modes.code}
              </button>
              <button
                type="button"
                onClick={() => setEditorMode('preview')}
                className={cn(
                  'flex items-center gap-1 rounded px-2 py-1 font-medium transition',
                  editorMode === 'preview'
                    ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Eye className="h-3.5 w-3.5" />
                {copy.modes.preview}
              </button>
            </div>
          </div>

          {editorMode === 'preview' ? (
            <div className="max-h-[360px] min-h-[220px] overflow-y-auto rounded-md border border-border bg-card p-4 text-xs">
              <RichContentRenderer content={content} />
            </div>
          ) : editorMode === 'visual' ? (
            <div className="overflow-hidden rounded-md border border-border">
              <TinyMceEditor
                value={content}
                onChange={setContent}
                onInit={(_event, editor) => { modalEditorRef.current = editor; }}
                locale={locale}
                height={280}
                placeholder={copy.visualPlaceholder}
              />
            </div>
          ) : (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              placeholder={copy.bodyPlaceholder}
              className="font-mono text-xs leading-relaxed"
              required
            />
          )}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {wordCount} {copy.words} • {charCount} {copy.characters}
            </span>
            <span className="italic">
              {copy.markupHint}
            </span>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
          {onOpenStudio ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenStudio({
                  ...announcement,
                  title,
                  content,
                  priority,
                  targetRoles:
                    targetRole === 'ALL' || targetRole === 'BOTH'
                      ? ['STUDENT', 'LECTURER']
                      : [targetRole],
                  isGlobal: targetRole === 'ALL',
                });
              }}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              title={copy.studioTooltip}
            >
              <Wand2 className="h-3.5 w-3.5 text-primary" />
              <span>{copy.studioAction}</span>
            </Button>
          ) : <div />}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={isSaving}
              className="text-xs"
            >
              {copy.cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSaving}
              className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold px-4 shadow-xs"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{copy.saving}</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>{copy.save}</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
