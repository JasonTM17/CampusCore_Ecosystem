'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { academicYearsApi, adminSemestersApi } from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminDialogFooter,
  AdminFormField,
  AdminPaginationFooter,
  AdminRowActions,
  AdminTableCard,
  AdminTableScroll,
  AdminToolbarCard,
  AdminToolbarMeta,
} from '@/components/admin/AdminSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { useI18n } from '@/i18n';

interface Semester {
  id: string;
  name: string;
  type: string;
  academicYearId: string;
  academicYear?: { year: number };
  startDate: string;
  endDate: string;
  status: string;
}

interface AcademicYearOption {
  id: string;
  year: number;
}

export default function AdminSemestersPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const { href, locale, formatDate, messages } = useI18n();
  const router = useRouter();
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSemester, setEditingSemester] = useState<Semester | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'FALL',
    academicYearId: '',
    startDate: '',
    endDate: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push(href('/dashboard'));
    }
  }, [href, isAdmin, isSuperAdmin, router, user]);

  const fetchAcademicYears = useCallback(async () => {
    try {
      const response = await academicYearsApi.getAll({ limit: 1000 });
      setAcademicYears(response.data || []);
    } catch {
      // The table can still render without dropdown helpers.
    }
  }, []);

  const fetchSemesters = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await adminSemestersApi.getAll({ page, limit: 20 });
      const filteredSemesters = search
        ? response.data.filter(
            (semester: Semester) =>
              semester.name.toLowerCase().includes(search.toLowerCase()) ||
              semester.type.toLowerCase().includes(search.toLowerCase()) ||
              String(semester.academicYear?.year || '').includes(search.trim()),
          )
        : response.data;

      setSemesters(filteredSemesters);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError(
        locale === 'vi'
          ? 'Hiện chưa thể tải danh sách học kỳ.'
          : 'Semesters could not be loaded.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [locale, page, search]);

  const semesterTypeOptions = useMemo(
    () => [
      { value: 'FALL', label: locale === 'vi' ? 'Học kỳ thu' : 'Fall' },
      { value: 'SPRING', label: locale === 'vi' ? 'Học kỳ xuân' : 'Spring' },
      { value: 'SUMMER', label: locale === 'vi' ? 'Học kỳ hè' : 'Summer' },
    ],
    [locale],
  );

  const copy = useMemo(
    () =>
      locale === 'vi'
        ? {
          loading: 'Đang tải học kỳ',
          title: 'Học kỳ',
          description:
            'Giữ timeline học thuật rõ ràng để đăng ký, section và tài chính cùng bám vào cùng một mốc vận hành.',
          create: 'Tạo học kỳ',
          searchLabel: 'Tìm học kỳ',
          searchPlaceholder: 'Tìm theo học kỳ, loại hoặc năm',
          pageSummaryEmpty: 'Không có bản ghi phù hợp',
          pageSummary: (currentPage: number, pages: number) =>
            `Trang ${currentPage} / ${pages}`,
          selectAcademicYear: 'Chọn năm học',
          unavailableTitle: 'Học kỳ chưa sẵn sàng',
          emptyTitle: 'Không có học kỳ phù hợp',
          emptyDescription:
            'Hãy tạo học kỳ để section, hóa đơn, đăng ký và báo cáo có cùng một timeline rõ ràng.',
          tableTitle: 'Bản ghi học kỳ',
          headers: {
            name: 'Tên học kỳ',
            type: 'Loại',
            academicYear: 'Năm học',
            startDate: 'Ngày bắt đầu',
            endDate: 'Ngày kết thúc',
            status: 'Trạng thái',
            actions: 'Tác vụ',
          },
          unassigned: 'Chưa gán',
          deleteTitle: 'Xóa học kỳ',
          deleteMessage: (name: string) =>
            `Xóa ${name}? Hành động này sẽ gỡ học kỳ khỏi màn hình quản trị hiện tại.`,
          deleteConfirm: 'Xóa học kỳ',
          deleted: 'Đã xóa học kỳ',
          deleteFailed: 'Hiện chưa thể xóa học kỳ này.',
          updated: 'Đã cập nhật học kỳ',
          created: 'Đã tạo học kỳ',
          saveFailed: 'Hiện chưa thể lưu học kỳ.',
          editTitle: 'Chỉnh sửa học kỳ',
          createTitle: 'Tạo học kỳ',
          fields: {
            name: 'Tên học kỳ',
            namePlaceholder: 'Ví dụ: Thu 2026',
            type: 'Loại',
            academicYear: 'Năm học',
            startDate: 'Ngày bắt đầu',
            endDate: 'Ngày kết thúc',
          },
          saving: 'Đang lưu...',
          editAction: messages.common.actions.saveChanges,
          editLabel: (name: string) => `Chỉnh sửa học kỳ ${name}`,
          deleteLabel: (name: string) => `Xóa học kỳ ${name}`,
        }
        : {
          loading: 'Loading semesters',
          title: 'Semesters',
          description:
            'Keep registration windows and teaching periods anchored to a clean academic timeline.',
          create: 'Create semester',
          searchLabel: 'Search semesters',
          searchPlaceholder: 'Search by semester, type, or year',
          pageSummaryEmpty: 'No matching records',
          pageSummary: (currentPage: number, pages: number) =>
            `Page ${currentPage} of ${pages}`,
          selectAcademicYear: 'Select academic year',
          unavailableTitle: 'Semesters unavailable',
          emptyTitle: 'No matching semesters',
          emptyDescription:
            'Create a semester to anchor sections, invoices, registration timing, and reporting.',
          tableTitle: 'Semester records',
          headers: {
            name: 'Name',
            type: 'Type',
            academicYear: 'Academic year',
            startDate: 'Start date',
            endDate: 'End date',
            status: 'Status',
            actions: 'Actions',
          },
          unassigned: 'Unassigned',
          deleteTitle: 'Delete semester',
          deleteMessage: (name: string) =>
            `Delete ${name}? This removes the semester from the current admin view.`,
          deleteConfirm: 'Delete semester',
          deleted: 'Semester deleted',
          deleteFailed: 'We could not delete that semester.',
          updated: 'Semester updated',
          created: 'Semester created',
          saveFailed: 'The semester could not be saved.',
          editTitle: 'Edit semester',
          createTitle: 'Create semester',
          fields: {
            name: 'Semester name',
            namePlaceholder: 'e.g. Fall 2026',
            type: 'Type',
            academicYear: 'Academic year',
            startDate: 'Start date',
            endDate: 'End date',
          },
          saving: 'Saving...',
          editAction: messages.common.actions.saveChanges,
          editLabel: (name: string) => `Edit semester ${name}`,
          deleteLabel: (name: string) => `Delete semester ${name}`,
        },
    [locale, messages.common.actions.saveChanges],
  );

  useEffect(() => {
    if (canAccess) {
      void fetchAcademicYears();
      void fetchSemesters();
    }
  }, [canAccess, fetchAcademicYears, fetchSemesters]);

  const pageSummary = useMemo(() => {
    if (semesters.length === 0) {
      return copy.pageSummaryEmpty;
    }

    return copy.pageSummary(page, totalPages);
  }, [copy, page, semesters.length, totalPages]);

  const academicYearOptions = useMemo(
    () => [
      { value: '', label: copy.selectAcademicYear },
      ...academicYears.map((year) => ({
        value: year.id,
        label: String(year.year),
      })),
    ],
    [academicYears, copy.selectAcademicYear],
  );

  if (!canAccess) {
    return <LoadingState label={copy.loading} className="m-8" />;
  }

  const resetForm = () => {
    setEditingSemester(null);
    setFormData({
      name: '',
      type: 'FALL',
      academicYearId: '',
      startDate: '',
      endDate: '',
    });
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (semester: Semester) => {
    setEditingSemester(semester);
    setFormData({
      name: semester.name,
      type: semester.type,
      academicYearId: semester.academicYearId,
      startDate: semester.startDate.split('T')[0],
      endDate: semester.endDate.split('T')[0],
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    await fetchSemesters();
  };

  const handleDelete = async (semester: Semester) => {
    const shouldDelete = await confirm({
      title: copy.deleteTitle,
      message: copy.deleteMessage(semester.name),
      confirmText: copy.deleteConfirm,
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await adminSemestersApi.delete(semester.id);
      toast.success(copy.deleted);
      await fetchSemesters();
    } catch {
      toast.error(copy.deleteFailed);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      if (editingSemester) {
        await adminSemestersApi.update(editingSemester.id, formData);
        toast.success(copy.updated);
      } else {
        await adminSemestersApi.create(formData);
        toast.success(copy.created);
      }

      closeModal();
      await fetchSemesters();
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ?? copy.saveFailed,
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminFrame
      title={copy.title}
      description={copy.description}
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {copy.create}
        </Button>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <form
              onSubmit={handleSearch}
              className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"
            >
              <div className="w-full max-w-xl">
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {copy.searchLabel}
                </label>
                <Input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  icon={<Search className="h-4 w-4" />}
                />
              </div>
              <AdminToolbarMeta
                summary={pageSummary}
                actions={
                  <Button type="submit" variant="outline">
                    {messages.common.actions.search}
                  </Button>
                }
              />
            </form>
        </AdminToolbarCard>

        {error ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={error}
            onRetry={() => void fetchSemesters()}
          />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : semesters.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            action={<Button onClick={openCreate}>{copy.create}</Button>}
          />
        ) : (
          <AdminTableCard
            title={copy.tableTitle}
            footer={
              <AdminPaginationFooter
                summary={pageSummary}
                page={page}
                totalPages={totalPages}
                onPrevious={() => setPage((current) => current - 1)}
                onNext={() => setPage((current) => current + 1)}
              />
            }
          >
              <AdminTableScroll>
                <table className="w-full min-w-[840px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">{copy.headers.name}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.type}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.academicYear}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.startDate}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.endDate}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.status}</th>
                      <th className="px-2 py-3 text-right font-medium">{copy.headers.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {semesters.map((semester) => (
                      <tr key={semester.id}>
                        <td className="px-2 py-4 font-medium text-foreground">
                          {semester.name}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {semester.type}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {semester.academicYear?.year || copy.unassigned}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {formatDate(semester.startDate)}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {formatDate(semester.endDate)}
                        </td>
                        <td className="px-2 py-4">
                          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            {semester.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(semester)}
                              aria-label={copy.editLabel(semester.name)}
                              title={copy.editLabel(semester.name)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(semester)}
                              aria-label={copy.deleteLabel(semester.name)}
                              title={copy.deleteLabel(semester.name)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AdminRowActions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AdminTableScroll>
          </AdminTableCard>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingSemester ? copy.editTitle : copy.createTitle}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <AdminFormField label={copy.fields.name}>
            <Input
              type="text"
              value={formData.name}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder={copy.fields.namePlaceholder}
              required
            />
          </AdminFormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={copy.fields.type}
              value={formData.type}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  type: event.target.value,
                }))
              }
              options={semesterTypeOptions}
            />
            <Select
              label={copy.fields.academicYear}
              value={formData.academicYearId}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  academicYearId: event.target.value,
                }))
              }
              options={academicYearOptions}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label={copy.fields.startDate}>
              <Input
                type="date"
                value={formData.startDate}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
                required
              />
            </AdminFormField>
            <AdminFormField label={copy.fields.endDate}>
              <Input
                type="date"
                value={formData.endDate}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
                required
              />
            </AdminFormField>
          </div>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              {messages.common.actions.cancel}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? copy.saving
                : editingSemester
                  ? copy.editAction
                  : copy.create}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
