'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CalendarOff,
  Check,
  Eye,
  FileCheck,
  FileEdit,
  GraduationCap,
  ImageIcon,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { announcementsApi, sectionsApi, type AnnouncementMutation } from '@/lib/api';
import type { GradingSection } from '@/types/api';
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
import { TinyMceEditor } from '@/components/ui/tinymce-editor';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { EDIT_BANNER_PRESETS } from '@/components/announcements/AnnouncementEditModal';
import { cn } from '@/lib/utils';
import { replaceCoverBlock, removeCoverBlock } from '@/lib/cover-banner';
import { campusCodeMessage } from '@/lib/campus-error';
import {
  announcementWorkspaceEn,
  announcementWorkspaceVi,
} from '@/i18n/messages-announcements';
import { toast } from 'sonner';

interface LecturerAnnouncementCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  lecturerName?: string;
}

type PresetKey = 'LEAVE_MAKEUP' | 'ASSIGNMENT_DEADLINE' | 'EXAM_SCHEDULE' | 'COURSE_GENERAL';

interface PresetItem {
  key: PresetKey;
  icon: React.ElementType;
  defaultPriority: 'NORMAL' | 'HIGH' | 'URGENT';
}

const PRESETS: PresetItem[] = [
  { key: 'LEAVE_MAKEUP', icon: CalendarOff, defaultPriority: 'HIGH' },
  { key: 'ASSIGNMENT_DEADLINE', icon: FileCheck, defaultPriority: 'HIGH' },
  { key: 'EXAM_SCHEDULE', icon: GraduationCap, defaultPriority: 'URGENT' },
  { key: 'COURSE_GENERAL', icon: BookOpen, defaultPriority: 'NORMAL' },
];

export function LecturerAnnouncementCreateModal({
  isOpen,
  onClose,
  onSuccess,
  lecturerName,
}: LecturerAnnouncementCreateModalProps) {
  const { locale, messages } = useI18n();
  const isVi = locale === 'vi';
  const workspaceCopy = { en: announcementWorkspaceEn, vi: announcementWorkspaceVi }[locale];
  const copy = workspaceCopy.composer.lecturer;
  const templateBodies = workspaceCopy.templates.body;
  const templateCopy = messages.announcementTemplates;
  const templateMeta = (key: PresetKey) => templateCopy[key];
  const initialTemplate = templateMeta(PRESETS[0].key);
  const draftCopy = messages.lecturerAnnouncementDraft;
  const { confirm, confirmationDialog } = useConfirmationDialog();

  // LEC-P3-B2: the host page keeps this modal mounted, so the values above
  // are the pristine baseline every reset returns to and every dirty check
  // compares against.
  const initialTitle = initialTemplate.defaultTitle;
  const initialContent = templateBodies.LEAVE_MAKEUP;

  const [title, setTitle] = useState(initialTemplate.defaultTitle);
  const [content, setContent] = useState(templateBodies.LEAVE_MAKEUP);
  const [priority, setPriority] = useState<'URGENT' | 'HIGH' | 'NORMAL' | 'LOW'>('HIGH');
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('LEAVE_MAKEUP');
  const [editorMode, setEditorMode] = useState<'visual' | 'code' | 'preview'>('visual');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [sections, setSections] = useState<GradingSection[]>([]);
  const [sectionsState, setSectionsState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [selectedSectionId, setSelectedSectionId] = useState('');

  // The backend hard-rejects lecturer announcements without an owned
  // sectionId (LECTURER_ANNOUNCEMENT_FORBIDDEN), so the picker is loaded
  // whenever the composer opens rather than trusting props to arrive.
  const loadSections = () => {
    setSectionsState('loading');
    sectionsApi
      .getMyGradingSections()
      .then((list) => {
        setSections(Array.isArray(list) ? list : []);
        setSectionsState('ready');
      })
      .catch(() => setSectionsState('error'));
  };

  useEffect(() => {
    if (isOpen && sectionsState === 'idle') {
      loadSections();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active cover image detection from content
  const activeCoverUrl =
    EDIT_BANNER_PRESETS.find((b) => content.includes(b.url))?.url ||
    content.match(/src=["'](\/images\/(?:banners|news)\/[^"']+)["']/i)?.[1] ||
    null;

  const handleApplyBanner = (bannerUrl: string, bannerTitle: string) => {
    const figureMarkup = `<figure class="my-3 text-center">\n  <img src="${bannerUrl}" alt="${bannerTitle}" class="w-full rounded-lg object-cover max-h-72 shadow-xs" />\n  <figcaption class="mt-1.5 text-xs text-muted-foreground italic">${bannerTitle}</figcaption>\n</figure>\n\n`;

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

  // LEC-P3-B2: wipe every authored field back to the template defaults. The
  // TinyMCE surface is driven by the controlled `value` prop, so resetting
  // `content` here also clears the WYSIWYG document.
  const resetForm = () => {
    setSelectedPreset(PRESETS[0].key);
    setTitle(initialTemplate.defaultTitle);
    setContent(templateBodies.LEAVE_MAKEUP);
    setPriority('HIGH');
    setEditorMode('visual');
    setValidationError('');
  };

  const isDraftDirty = title !== initialTitle || content !== initialContent || priority !== 'HIGH';

  // LEC-P3-B2: closing mid-draft is destructive, so it goes through the same
  // inline confirm the admin announcement editor uses before discarding.
  const requestClose = async () => {
    if (isSubmitting) return;
    if (isDraftDirty) {
      const discard = await confirm({
        title: draftCopy.discardTitle,
        message: draftCopy.discardMessage,
        confirmText: draftCopy.discardConfirm,
        cancelText: draftCopy.discardCancel,
        variant: 'destructive',
      });
      if (!discard) return;
    }
    resetForm();
    onClose();
  };

  const handleApplyPreset = (preset: PresetItem) => {
    setSelectedPreset(preset.key);
    setTitle(templateMeta(preset.key).defaultTitle);
    setContent(templateBodies[preset.key]);
    setPriority(preset.defaultPriority);
    setValidationError('');
  };

  const handleFormSubmit = async (submitForReview: boolean) => {
    if (!title.trim()) {
      setValidationError(copy.validationTitle);
      return;
    }
    if (!content.trim()) {
      setValidationError(copy.validationContent);
      return;
    }
    if (!selectedSectionId) {
      setValidationError(copy.validationSection);
      return;
    }
    // A fourth authoring surface: this modal writes announcements directly, so it
    // must consult the same length contract as the editor page rather than letting
    // the server answer with an opaque 400.
    const overflow = findAnnouncementLengthViolation(content);
    if (overflow) {
      setValidationError(
        announcementLengthViolationMessage(overflow, locale),
      );
      return;
    }

    setValidationError('');
    setIsSubmitting(true);

    try {
      const payload: AnnouncementMutation = {
        title: title.trim(),
        content: content.trim(),
        priority,
        targetRoles: ['STUDENT'],
        isGlobal: false,
        sectionId: selectedSectionId,
      };

      // publication-policy §3: create lands in DRAFT; publishing only happens
      // through submit → a different reviewer's approve. `submitForReview`
      // chains the draft straight into the review queue so author intent
      // stays one click, while the honest copy never claims publication.
      const created = await announcementsApi.create(payload);
      if (submitForReview) {
        try {
          await announcementsApi.submit(created.id);
          toast.success(copy.submittedForReview);
        } catch {
          // The draft already exists — reporting a save failure would invite
          // a retry that creates a duplicate. The queue shows it for a
          // one-click submit instead.
          toast.success(copy.draftSaved);
        }
      } else {
        toast.success(copy.draftSaved);
      }
      // LEC-P3-B2: clear the saved draft BEFORE closing. The host page
      // keeps this modal mounted, so leftover state used to reopen showing
      // the just-saved text, and a second save created a duplicate.
      resetForm();
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(campusCodeMessage(err, messages.common.campusErrors, copy.saveFailed));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={() => void requestClose()}
      title={copy.title}
      className="max-w-3xl"
    >
      <form onSubmit={(e) => { e.preventDefault(); void handleFormSubmit(true); }} className="space-y-5">
        {/* Quick presets bar */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {copy.presetLabel}
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRESETS.map((p) => {
              const Icon = p.icon;
              const isSelected = selectedPreset === p.key;
              const presetCopy = templateMeta(p.key);
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handleApplyPreset(p)}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition duration-150',
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary shadow-xs'
                      : 'border-border/70 bg-card hover:border-primary/40 hover:bg-secondary/40 text-foreground'
                  )}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-xs">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{presetCopy.label}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground line-clamp-1">
                    {presetCopy.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Target section — required by the backend guard */}
        <div className="space-y-1.5">
          <label
            htmlFor="lecturer-announcement-section"
            className="text-xs font-semibold text-foreground"
          >
            {copy.sectionLabel}
          </label>
          {sectionsState === 'loading' ? (
            <div className="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {copy.loadingSections}
            </div>
          ) : sectionsState === 'error' ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              <span className="text-status-danger-foreground">
                {copy.loadSectionsFailed}
              </span>
              <button
                type="button"
                onClick={loadSections}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {copy.retry}
              </button>
            </div>
          ) : sectionsState === 'ready' && sections.length === 0 ? (
            <div className="rounded-md border border-border/80 bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
              {copy.noSections}
            </div>
          ) : (
            <select
              id="lecturer-announcement-section"
              value={selectedSectionId}
              onChange={(e) => setSelectedSectionId(e.target.value)}
              className="w-full rounded-md border border-border/80 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">
                {copy.selectSection}
              </option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {(isVi ? section.courseNameVi : section.courseNameEn) || section.courseName}
                  {' · '}
                  {copy.sectionWord} {section.sectionNumber}
                  {section.semesterName ? ` · ${section.semesterName}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Priority & Target Audience */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="lecturer-announcement-priority"
              className="text-xs font-semibold text-foreground"
            >
              {copy.priorityLabel}
            </label>
            <select
              id="lecturer-announcement-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              className="w-full rounded-md border border-border/80 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="NORMAL">{copy.priority.NORMAL}</option>
              <option value="HIGH">{copy.priority.HIGH}</option>
              <option value="URGENT">{copy.priority.URGENT}</option>
              <option value="LOW">{copy.priority.LOW}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              {copy.audienceLabel}
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/20 px-3 py-2 text-sm text-foreground">
              <GraduationCap className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 font-medium">{copy.students}</span>
              <span className="ml-auto shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                STUDENT
              </span>
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <label htmlFor="lecturer-announcement-title" className="text-xs font-semibold text-foreground">
            {copy.titleLabel}
          </label>
          <Input
            id="lecturer-announcement-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={copy.titlePlaceholder}
            className="text-sm font-medium"
          />
        </div>

        {/* Editorial Cover Image Preset Tray */}
        <div className="space-y-2 rounded-lg border border-border/70 bg-secondary/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-primary" />
              {copy.coverLabel}
            </span>
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
                  onClick={() => handleApplyBanner(banner.url, bannerTitle)}
                  className={cn(
                    'group relative flex flex-col overflow-hidden rounded-lg border text-left transition-all duration-150',
                    isSelected
                      ? 'border-primary ring-2 ring-primary/40 shadow-xs'
                      : 'border-border/70 bg-card hover:border-primary/50'
                  )}
                >
                  <div className="relative h-16 w-full overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={banner.url}
                      alt={bannerTitle}
                      width={banner.width}
                      height={banner.height}
                      className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-105"
                    />
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

        {/* Mode Toggle Bar: Visual (TinyMCE) vs Code vs Preview */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <label className="text-xs font-semibold text-foreground">
              {copy.contentLabel}
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
            <div className="min-h-[240px] max-h-[360px] overflow-y-auto rounded-md border border-border/80 bg-card p-4">
              <div className="border-b border-border/60 pb-2 mb-3">
                <h3 className="font-bold text-base text-foreground">{title || '—'}</h3>
              </div>
              <RichContentRenderer content={content} />
            </div>
          ) : editorMode === 'visual' ? (
            <div className="overflow-hidden rounded-md border border-border/80">
              <TinyMceEditor
                value={content}
                onChange={setContent}
                locale={locale}
                height={280}
                placeholder={
                  copy.visualPlaceholder
                }
              />
            </div>
          ) : (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={9}
              placeholder={copy.bodyPlaceholder}
              className="font-mono text-xs leading-relaxed"
            />
          )}
        </div>

        {validationError ? (
          <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{validationError}</span>
          </div>
        ) : null}

        {/* Dialog Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-border/70 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => void requestClose()}
            disabled={isSubmitting}
          >
            {copy.cancel}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => void handleFormSubmit(false)}
          >
            {copy.saveDraft}
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{copy.submitting}</span>
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                <span>{copy.submitReview}</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
    {/* LEC-P3-B2: inline discard confirm, rendered beside the composer the
        same way the admin announcements page renders it beside its editor. */}
    {confirmationDialog}
    </>
  );
}
