'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  BookOpenCheck,
  Check,
  Edit3,
  FileText,
  Plus,
  Send,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { adminOpsEn, adminOpsVi } from '@/i18n/messages-admin-ops';
import { useI18n } from '@/i18n';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminFormField,
  AdminMetricCard,
  AdminPaginationFooter,
  AdminTableCard,
  AdminTableScroll,
} from '@/components/admin/AdminSurface';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmModal, Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { EmptyState, ForbiddenState, LoadingState } from '@/components/ui/state-block';
import { metricToneClass, statusToneClass } from '@/components/ui/status';
import { LinkButton } from '@/components/ui/link-button';
import { normalizeVietnameseText } from '@/lib/registration-browse';
import {
  assistantKnowledgeApi,
  type AssistantCatalogCoverage,
  type AssistantKnowledgeDocument,
  type AssistantKnowledgeDomain,
  type AssistantKnowledgeRequest,
  type AssistantKnowledgeState,
} from '@/lib/thesis-api';

// Filter option lists carry both locales so one source feeds the filter
// selects, the table badges, and the form — no per-option ternary chains.
const states: Array<{ value: '' | AssistantKnowledgeState; en: string; vi: string }> = [
  { value: '', en: 'All states', vi: 'Tất cả trạng thái' },
  { value: 'DRAFT', en: 'Draft', vi: 'Bản nháp' },
  { value: 'PENDING_REVIEW', en: 'Pending review', vi: 'Chờ duyệt' },
  { value: 'PUBLISHED', en: 'Published', vi: 'Đã xuất bản' },
  { value: 'ARCHIVED', en: 'Archived', vi: 'Đã lưu trữ' },
];
const PAGE_SIZE = 25;
const domains: Array<{ value: '' | AssistantKnowledgeDomain; en: string; vi: string }> = [
  { value: '', en: 'All domains', vi: 'Tất cả lĩnh vực' },
  { value: 'THESIS', en: 'Thesis', vi: 'Luận văn' },
  { value: 'REGISTRATION', en: 'Registration', vi: 'Đăng ký học phần' },
  { value: 'ACADEMIC_CATALOG', en: 'Academic catalog', vi: 'Danh mục học vụ' },
  { value: 'ANNOUNCEMENT', en: 'Announcements', vi: 'Thông báo' },
  { value: 'POLICY', en: 'Policy', vi: 'Chính sách' },
  { value: 'GENERAL_FAQ', en: 'Campus FAQ', vi: 'Câu hỏi thường gặp' },
  { value: 'SPECIALIZED', en: 'Specialized knowledge', vi: 'Kiến thức chuyên ngành' },
];
const coverageSections: Array<{ key: keyof AssistantCatalogCoverage; en: string; vi: string }> = [
  { key: 'departments', en: 'Departments', vi: 'Khoa' },
  { key: 'courses', en: 'Courses', vi: 'Môn học' },
  { key: 'curricula', en: 'Curricula', vi: 'Chương trình' },
  { key: 'semesters', en: 'Semesters', vi: 'Học kỳ' },
];

const blankForm: AssistantKnowledgeRequest = {
  slug: '',
  locale: 'both',
  title: '',
  content: '',
  source: 'CampusUTE academic policy',
  domain: 'GENERAL_FAQ',
  priority: 100,
};

function isStaleVersionError(error: unknown) {
  const response = (error as { response?: { data?: { code?: string } } })?.response;
  return response?.data?.code === 'STALE_VERSION';
}

function actionError(error: unknown, locale: 'en' | 'vi') {
  const opsCopy = locale === 'vi' ? adminOpsVi.assistantKnowledge : adminOpsEn.assistantKnowledge;
  const response = (error as { response?: { status?: number; data?: { code?: string } } })?.response;
  if (isStaleVersionError(error)) {
    return opsCopy.staleVersion;
  }
  if (response?.status === 409 || response?.data?.code === 'KNOWLEDGE_SECOND_REVIEW_REQUIRED') {
    return opsCopy.errorSecondReview;
  }
  if (response?.status === 403) {
    return opsCopy.errorForbidden;
  }
  return opsCopy.errorGeneric;
}

function stateClass(state: string) {
  if (state === 'PUBLISHED') return statusToneClass('success');
  if (state === 'PENDING_REVIEW') return statusToneClass('warning');
  if (state === 'ARCHIVED') return statusToneClass('neutral');
  return statusToneClass('info');
}

function stateLabel(state: string, vi: boolean) {
  const option = states.find((item) => item.value === state);
  return option ? (vi ? option.vi : option.en) : (vi ? adminOpsVi.assistantKnowledge.unknownState : adminOpsEn.assistantKnowledge.unknownState);
}

function domainLabel(domain: string | undefined, vi: boolean) {
  const option = domains.find((item) => item.value === domain);
  return option ? (vi ? option.vi : option.en) : (vi ? adminOpsVi.assistantKnowledge.otherDomain : adminOpsEn.assistantKnowledge.otherDomain);
}

function localizedOptions(
  items: Array<{ value: '' | AssistantKnowledgeState | AssistantKnowledgeDomain; en: string; vi: string }>,
  vi: boolean,
) {
  return items.map((item) => ({ value: item.value, label: vi ? item.vi : item.en }));
}

interface CatalogCoverageCardProps {
  coverage: AssistantCatalogCoverage | null;
  coverageError: boolean;
  vi: boolean;
}

function CatalogCoverageCard({ coverage, coverageError, vi }: CatalogCoverageCardProps) {
  const opsUi = vi ? adminOpsVi.assistantKnowledge.ui : adminOpsEn.assistantKnowledge.ui;
  return (
    <Card variant="muted">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <BookOpenCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          {opsUi.publicCampusuteGuidance}
        </CardTitle>
        <CardDescription>
          {vi
            ? 'Chỉ hiển thị số lượng nội dung học thuật công khai. Không bao gồm hồ sơ, điểm, điểm danh, lịch cá nhân hoặc danh sách lớp.'
            : 'A quick count of public academic guidance. Personal records, grades, attendance, schedules, and class lists are not included.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {coverage ? (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {coverageSections.map((section) => (
              <div key={section.key} className="border border-border/70 bg-background px-3 py-2">
                <div className="text-xs text-muted-foreground">{vi ? section.vi : section.en}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                  {coverage[section.key]}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {coverageError
              ? vi
                ? 'Phạm vi thông tin hiện chưa khả dụng. Nội dung đã kiểm duyệt vẫn hoạt động.'
                : 'Public information counts are currently unavailable. Reviewed guidance remains available.'
              : vi
                ? 'Đang tải thông tin...'
                : 'Loading information...'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface GuidanceFiltersProps {
  domainFilter: '' | AssistantKnowledgeDomain;
  stateFilter: '' | AssistantKnowledgeState;
  search: string;
  onDomainChange: (value: '' | AssistantKnowledgeDomain) => void;
  onStateChange: (value: '' | AssistantKnowledgeState) => void;
  onSearchChange: (value: string) => void;
  onReload: () => void;
  isLoading: boolean;
  vi: boolean;
}

function GuidanceFilters({
  domainFilter,
  stateFilter,
  search,
  onDomainChange,
  onStateChange,
  onSearchChange,
  onReload,
  isLoading,
  vi,
}: GuidanceFiltersProps) {
  const opsUi = vi ? adminOpsVi.assistantKnowledge.ui : adminOpsEn.assistantKnowledge.ui;
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Select
            label={opsUi.domain}
            value={domainFilter}
            onChange={(event) => onDomainChange(event.target.value as '' | AssistantKnowledgeDomain)}
            options={localizedOptions(domains, vi)}
            aria-label={opsUi.filterDomain}
          />
        </div>
        <div className="w-48">
          <Select
            label={opsUi.status}
            value={stateFilter}
            onChange={(event) => onStateChange(event.target.value as '' | AssistantKnowledgeState)}
            options={localizedOptions(states, vi)}
            aria-label={opsUi.filterStatus}
          />
        </div>
        <div className="w-64">
          <label className="mb-1 block text-sm font-medium text-foreground">
            {opsUi.search}
          </label>
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={opsUi.slugOrTitle}
            aria-label={opsUi.searchDocuments}
          />
        </div>
      </div>
      <Button type="button" variant="outline" onClick={onReload} disabled={isLoading}>
        {opsUi.reload}
      </Button>
    </div>
  );
}

interface GuidanceTableProps {
  documents: AssistantKnowledgeDocument[];
  isSaving: boolean;
  vi: boolean;
  onEdit: (document: AssistantKnowledgeDocument) => void;
  onTransition: (document: AssistantKnowledgeDocument, operation: 'submit' | 'publish') => void;
  onArchiveRequest: (document: AssistantKnowledgeDocument) => void;
}

function GuidanceTable({
  documents,
  isSaving,
  vi,
  onEdit,
  onTransition,
  onArchiveRequest,
}: GuidanceTableProps) {
  const opsUi = vi ? adminOpsVi.assistantKnowledge.ui : adminOpsEn.assistantKnowledge.ui;
  return (
    <AdminTableScroll>
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-secondary text-xs uppercase tracking-[0.08em] text-muted-foreground">
          <tr>
            <th className="px-3 py-3 font-semibold">{opsUi.guidance}</th>
            <th className="px-3 py-3 font-semibold">{opsUi.domain2}</th>
            <th className="px-3 py-3 font-semibold">{opsUi.status2}</th>
            <th className="px-3 py-3 font-semibold">{opsUi.revision}</th>
            <th className="px-3 py-3 text-right font-semibold">{opsUi.actions}</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.documentId} className="border-b border-border/60 align-top last:border-0">
              <td className="max-w-[420px] px-3 py-4">
                <div className="font-semibold text-foreground">{document.title}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground" title={document.source}>{document.source}</div>
              </td>
              <td className="px-3 py-4">
                <span className="inline-flex rounded-md bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                  {domainLabel(document.domain, vi)}
                </span>
              </td>
              <td className="px-3 py-4">
                <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${stateClass(document.state)}`}>
                  {stateLabel(document.state, vi)}
                </span>
              </td>
              <td className="px-3 py-4 tabular-nums text-muted-foreground">v{document.version}</td>
              <td className="px-3 py-4">
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => onEdit(document)} disabled={isSaving}>
                    <Edit3 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {opsUi.edit}
                  </Button>
                  {document.state === 'DRAFT' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onTransition(document, 'submit')}
                      disabled={isSaving}
                    >
                      <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {opsUi.sendForReview}
                    </Button>
                  ) : null}
                  {document.state === 'PENDING_REVIEW' ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onTransition(document, 'publish')}
                      disabled={isSaving}
                    >
                      <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {opsUi.release}
                    </Button>
                  ) : null}
                  {document.state !== 'ARCHIVED' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onArchiveRequest(document)}
                      disabled={isSaving}
                    >
                      <Archive className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {opsUi.archive}
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminTableScroll>
  );
}

interface GuidanceFormModalProps {
  isOpen: boolean;
  isSaving: boolean;
  editing: boolean;
  form: AssistantKnowledgeRequest;
  formError: string;
  onChange: (patch: Partial<AssistantKnowledgeRequest>) => void;
  onClose: () => void;
  onSave: () => void;
  vi: boolean;
}

function GuidanceFormModal({
  isOpen,
  isSaving,
  editing,
  form,
  formError,
  onChange,
  onClose,
  onSave,
  vi,
}: GuidanceFormModalProps) {
  const opsUi = vi ? adminOpsVi.assistantKnowledge.ui : adminOpsEn.assistantKnowledge.ui;
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        editing
          ? vi
            ? 'Sửa nội dung đã kiểm duyệt'
            : 'Edit reviewed guidance'
          : vi
            ? 'Tạo nội dung mới'
            : 'Add guidance'
      }
      className="max-w-4xl"
    >
      <div className="space-y-4">
        {formError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm leading-6 text-status-danger-foreground"
          >
            {formError}
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <AdminFormField label={opsUi.guidanceCode}>
            <Input
              value={form.slug}
              onChange={(event) => onChange({ slug: event.target.value })}
              placeholder="registration-window"
            />
          </AdminFormField>
          <AdminFormField label={opsUi.domain22}>
            <Select
              value={form.domain ?? 'GENERAL_FAQ'}
              onChange={(event) => onChange({ domain: event.target.value as AssistantKnowledgeDomain })}
              options={localizedOptions(domains.filter((option) => option.value !== ''), vi)}
            />
          </AdminFormField>
          <AdminFormField label={opsUi.language}>
            <Select
              value={form.locale}
              onChange={(event) => onChange({ locale: event.target.value as AssistantKnowledgeRequest['locale'] })}
              options={[
                { value: 'both', label: opsUi.both },
                { value: 'vi', label: 'Tiếng Việt' },
                { value: 'en', label: 'English' },
              ]}
            />
          </AdminFormField>
        </div>

        <AdminFormField label={opsUi.title}>
          <Input value={form.title} onChange={(event) => onChange({ title: event.target.value })} />
        </AdminFormField>

        <AdminFormField label={opsUi.reference}>
          <Input value={form.source} onChange={(event) => onChange({ source: event.target.value })} />
        </AdminFormField>

        <div className="space-y-2 text-sm font-medium text-foreground">
          <span>{opsUi.guidanceContent}</span>
          <RichTextEditor
            value={form.content}
            onChange={(newContent) => onChange({ content: newContent })}
            locale={vi ? 'vi' : 'en'}
            minHeight="240px"
            hint={
              vi
                ? 'Chỉ nhập thông tin học vụ công khai. Không thêm hồ sơ hoặc dữ liệu cá nhân.'
                : 'Only public campus information. Do not add profiles or personal data.'
            }
            placeholder={
              vi
                ? 'Biên soạn nội dung quy chế hoặc hướng dẫn học vụ... (Hỗ trợ tiêu đề, bảng biểu, danh sách, callout)'
                : 'Draft academic guidance content... (Supports headings, tables, lists, callouts)'
            }
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
            {opsUi.cancel}
          </Button>
          <Button type="button" onClick={onSave} disabled={isSaving}>
            {isSaving ? (opsUi.saving) : (opsUi.saveDraft)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function AdminAssistantKnowledgePage() {
  const { user, isAdmin, isSuperAdmin, isLoading: authLoading, isLoggingOut } = useAuth();
  const { locale } = useI18n();
  const vi = locale === 'vi';
  const opsUi = vi ? adminOpsVi.assistantKnowledge.ui : adminOpsEn.assistantKnowledge.ui;
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const [documents, setDocuments] = useState<AssistantKnowledgeDocument[]>([]);
  const [coverage, setCoverage] = useState<AssistantCatalogCoverage | null>(null);
  const [coverageError, setCoverageError] = useState(false);
  const [stateFilter, setStateFilter] = useState<'' | AssistantKnowledgeState>('');
  const [domainFilter, setDomainFilter] = useState<'' | AssistantKnowledgeDomain>('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  const editRequestRef = useRef(0);
  const [editing, setEditing] = useState<AssistantKnowledgeDocument | null>(null);
  const [form, setForm] = useState<AssistantKnowledgeRequest>(blankForm);
  const [archiveTarget, setArchiveTarget] = useState<AssistantKnowledgeDocument | null>(null);
  // Save/validation failures render inside the open modals — the page-level
  // banner sits behind the dialog so callers never saw them.
  const [formError, setFormError] = useState('');
  const [archiveError, setArchiveError] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    setCoverageError(false);
    try {
      const [rows, catalog] = await Promise.all([
        assistantKnowledgeApi.list({ ...(domainFilter ? { domain: domainFilter } : {}), ...(stateFilter ? { state: stateFilter } : {}) }),
        assistantKnowledgeApi.getCatalogCoverage(),
      ]);
      setDocuments(rows);
      setCoverage(catalog);
    } catch (loadError) {
      // Keep curated and catalog surfaces independently truthful when the optional coverage read is unavailable.
      try {
        const rows = await assistantKnowledgeApi.list({ ...(domainFilter ? { domain: domainFilter } : {}), ...(stateFilter ? { state: stateFilter } : {}) });
        setDocuments(rows);
        setCoverageError(true);
      } catch {
        setError(actionError(loadError, locale));
      }
    } finally {
      setIsLoading(false);
    }
  }, [domainFilter, locale, stateFilter]);

  useEffect(() => {
    if (canAccess) void load();
  }, [canAccess, load]);

  const publishedCount = useMemo(() => documents.filter((row) => row.state === 'PUBLISHED').length, [documents]);
  const pendingCount = useMemo(() => documents.filter((row) => row.state === 'PENDING_REVIEW').length, [documents]);
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [domainFilter, stateFilter, search]);
  const filteredDocuments = useMemo(() => {
    const query = normalizeVietnameseText(search.trim());
    if (!query) return documents;
    return documents.filter((row) => {
      const haystack = normalizeVietnameseText(
        `${row.slug ?? ''} ${row.title ?? ''} ${row.source ?? ''} ${row.domain ?? ''} ${row.state ?? ''}`,
      );
      return query.split(/\s+/).filter(Boolean).every((token) => haystack.includes(token));
    });
  }, [documents, search]);
  const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedDocuments = useMemo(
    () => filteredDocuments.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredDocuments, currentPage],
  );
  const pageSummary = vi
    ? `Hiển thị ${pagedDocuments.length} trên ${filteredDocuments.length} mục`
    : `Showing ${pagedDocuments.length} of ${filteredDocuments.length} items`;

  const updateForm = useCallback((patch: Partial<AssistantKnowledgeRequest>) => {
    setForm((current) => ({ ...current, ...patch }));
  }, []);

  const openCreate = () => {
    editRequestRef.current += 1;
    setLoadingEditId(null);
    setEditing(null);
    setForm({ ...blankForm });
    setNotice('');
    setError('');
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = async (document: AssistantKnowledgeDocument) => {
    const requestId = ++editRequestRef.current;
    const isCurrent = () => requestId === editRequestRef.current;
    setLoadingEditId(document.documentId);
    setEditing(document);
    setNotice('');
    setError('');
    setFormError('');
    try {
      const fullDoc = await assistantKnowledgeApi.get(document.documentId);
      if (!isCurrent()) return;
      setEditing(fullDoc);
      setForm({
        slug: fullDoc.slug,
        locale: fullDoc.locale === 'vi' || fullDoc.locale === 'en' ? fullDoc.locale : 'both',
        title: fullDoc.title,
        content: fullDoc.content,
        source: fullDoc.source,
        domain: (fullDoc.domain as AssistantKnowledgeDomain) || 'GENERAL_FAQ',
        priority: fullDoc.priority,
      });
    } catch {
      if (!isCurrent()) return;
      // The list row deliberately carries content '' — opening the editor on
      // it would show a blank document and a save would clobber the real one.
      setEditing(null);
      setFormOpen(false);
      setError(vi
        ? 'Không tải được nội dung đầy đủ của tài liệu. Vui lòng thử lại.'
        : 'Could not load the full document. Please retry.');
      return;
    } finally {
      if (isCurrent()) {
        setLoadingEditId(null);
      }
    }
    if (!isCurrent()) return;
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.slug.trim() || !form.title.trim() || !form.content.trim() || !form.source.trim()) {
      setFormError(opsUi.guidanceCodeTitleContent);
      return;
    }
    setIsSaving(true);
    setFormError('');
    try {
      if (editing) {
        const saved = await assistantKnowledgeApi.update(editing.documentId, {
          ...form,
          expectedVersion: editing.version,
        });
        setEditing((current) => (
          current && current.documentId === editing.documentId
            ? { ...current, version: saved.version }
            : current
        ));
      } else {
        await assistantKnowledgeApi.create(form);
      }
      setFormOpen(false);
      setNotice(opsUi.draftSaved);
      await load();
    } catch (saveError) {
      if (isStaleVersionError(saveError)) {
        // Refresh the list so the newer revision is visible; the open editor
        // keeps the admin's typed content instead of replacing it.
        await load();
      }
      setFormError(actionError(saveError, locale));
    } finally {
      setIsSaving(false);
    }
  };

  const transition = async (document: AssistantKnowledgeDocument, operation: 'submit' | 'publish') => {
    setIsSaving(true);
    setError('');
    setNotice('');
    try {
      if (operation === 'submit') {
        await assistantKnowledgeApi.submit(document.documentId);
        setNotice(opsUi.submittedForReview);
      } else {
        const result = await assistantKnowledgeApi.publish(document.documentId);
        const pendingProjection = result.sync && (result.sync.degraded || result.sync.status !== 'ACTIVATED');
        setNotice(pendingProjection
          ? (opsUi.publishedTheAssistantHas)
          : (opsUi.guidancePublishedForThe));
      }
      await load();
    } catch (transitionError) {
      setError(actionError(transitionError, locale));
    } finally {
      setIsSaving(false);
    }
  };

  const archive = async () => {
    if (!archiveTarget) return;
    setIsSaving(true);
    setArchiveError('');
    try {
      const sync = await assistantKnowledgeApi.archive(archiveTarget.documentId);
      const pendingProjection = sync && (sync.degraded || (archiveTarget.state === 'PUBLISHED' && sync.status !== 'ACTIVATED'));
      setArchiveTarget(null);
      setNotice(pendingProjection
        ? (opsUi.archivedInAdministrationThe)
        : (opsUi.guidanceArchivedItsChange));
      await load();
    } catch (caught) {
      setArchiveError(actionError(caught, locale));
    } finally {
      setIsSaving(false);
    }
  };

  const frameTitle = opsUi.campusuteKnowledge;
  const frameDescription = vi
    ? 'Quản trị nội dung học vụ công khai cho trợ lý.'
    : 'Manage public campus guidance for the assistant.';

  if (authLoading || isLoggingOut) {
    return (
      <AdminFrame title={frameTitle} description={frameDescription}>
        <LoadingState />
      </AdminFrame>
    );
  }

  if (!user || !canAccess) {
    return (
      <AdminFrame title={frameTitle} description={frameDescription}>
        <ForbiddenState
          title={opsUi.accessRestricted}
          description={opsUi.onlyAdministratorsCanManage}
          action={
            <LinkButton href="/dashboard" variant="outline">
              {opsUi.returnToOverview}
            </LinkButton>
          }
        />
      </AdminFrame>
    );
  }

  return (
    <AdminFrame
      title={frameTitle}
      description={vi
        ? 'Quản trị nội dung học vụ công khai theo quy trình bản nháp, duyệt và xuất bản.'
        : 'Manage public campus guidance through draft, review, and release states.'}
      actions={
        <Button type="button" onClick={openCreate} disabled={isSaving || loadingEditId !== null}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {opsUi.addGuidance}
        </Button>
      }
    >
      {error ? (
        <div role="alert" className="mb-5 border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-status-danger-foreground">
          {error}{' '}
          <button
            type="button"
            className="ml-2 rounded font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void load()}
          >
            {opsUi.retry}
          </button>
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="mb-5 flex items-center gap-2 border border-status-success/30 bg-status-success/15 px-4 py-3 text-sm text-status-success-foreground"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {notice}
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <AdminMetricCard
            label={opsUi.totalGuidance}
            value={documents.length}
            icon={<FileText className="h-5 w-5" />}
            toneClassName={metricToneClass('info')}
            compact
          />
          <AdminMetricCard
            label={opsUi.published}
            value={publishedCount}
            icon={<ShieldCheck className="h-5 w-5" />}
            toneClassName={metricToneClass('success')}
            compact
          />
          <AdminMetricCard
            label={opsUi.pendingReview}
            value={pendingCount}
            icon={<UploadCloud className="h-5 w-5" />}
            toneClassName={metricToneClass('warning')}
            compact
          />
        </div>

        <CatalogCoverageCard coverage={coverage} coverageError={coverageError} vi={vi} />

        <AdminTableCard
          title={opsUi.reviewedGuidance}
          description={
            vi
              ? 'Nội dung được kiểm duyệt trước khi trợ lý sử dụng. Nội dung đã lưu trữ vẫn giữ lịch sử thay đổi.'
              : 'Guidance is reviewed before the assistant uses it. Archived items keep their change history.'
          }
          footer={
            <AdminPaginationFooter
              summary={pageSummary}
              page={currentPage}
              totalPages={totalPages}
              onPrevious={() => setPage((current) => current - 1)}
              onNext={() => setPage((current) => current + 1)}
            />
          }
        >
          <GuidanceFilters
            domainFilter={domainFilter}
            stateFilter={stateFilter}
            search={search}
            onDomainChange={setDomainFilter}
            onStateChange={setStateFilter}
            onSearchChange={setSearch}
            onReload={() => void load()}
            isLoading={isLoading}
            vi={vi}
          />
          {isLoading && documents.length === 0 ? (
            <LoadingState label={opsUi.loadingGuidance} />
          ) : filteredDocuments.length === 0 ? (
            <EmptyState
              title={opsUi.noMatchingGuidance}
              description={
                vi
                  ? 'Nội dung mới sẽ xuất hiện tại đây sau khi được tạo hoặc khi bộ lọc thay đổi.'
                  : 'New guidance will appear here once created or when the filters change.'
              }
            />
          ) : (
            <GuidanceTable
              documents={pagedDocuments}
              isSaving={isSaving || loadingEditId !== null}
              vi={vi}
              onEdit={(document) => void openEdit(document)}
              onTransition={(document, operation) => void transition(document, operation)}
              onArchiveRequest={(document) => {
                setArchiveError('');
                setArchiveTarget(document);
              }}
            />
          )}
        </AdminTableCard>
      </div>

      <GuidanceFormModal
        isOpen={formOpen}
        isSaving={isSaving}
        editing={Boolean(editing)}
        form={form}
        formError={formError}
        onChange={updateForm}
        onClose={() => {
          editRequestRef.current += 1;
          setLoadingEditId(null);
          setFormError('');
          setFormOpen(false);
        }}
        onSave={() => void save()}
        vi={vi}
      />
      <ConfirmModal
        isOpen={Boolean(archiveTarget)}
        onClose={() => {
          setArchiveError('');
          setArchiveTarget(null);
        }}
        onConfirm={() => void archive()}
        title={opsUi.archiveGuidance}
        message={
          vi
            ? 'Nội dung sẽ ngừng được sử dụng nhưng lịch sử thay đổi vẫn được giữ. Bạn có chắc không?'
            : 'This guidance will stop being used while its change history remains available. Continue?'
        }
        confirmText={opsUi.archive2}
        variant="destructive"
        isLoading={isSaving}
        error={archiveError}
      />
    </AdminFrame>
  );
}
