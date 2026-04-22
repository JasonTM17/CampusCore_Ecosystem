'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Eye, FileText, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  coursesApi,
  enrollmentsApi,
  sectionsApi,
  semestersApi,
} from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminDialogFooter,
  AdminPaginationFooter,
  AdminRowActions,
  AdminTableCard,
  AdminTableScroll,
  AdminToolbarCard,
} from '@/components/admin/AdminSurface';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { useI18n } from '@/i18n';

interface Enrollment {
  id: string;
  studentId: string;
  sectionId: string;
  semesterId: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'DROPPED' | 'CANCELLED';
  enrolledAt: string;
  droppedAt?: string;
  finalGrade?: number;
  letterGrade?: string;
  student?: {
    user?: { firstName?: string; lastName?: string; email?: string };
    studentCode?: string;
  };
  section?: {
    sectionNumber: string;
    course?: { code?: string; name?: string };
    lecturer?: { user?: { firstName?: string; lastName?: string } };
  };
  semester?: { name: string };
}

interface Semester {
  id: string;
  name: string;
}

interface Course {
  id: string;
  code: string;
  name: string;
}

interface Section {
  id: string;
  sectionNumber: string;
}

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  DROPPED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export default function AdminEnrollmentsPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const { formatDate, formatDateTime, formatNumber, href, locale, messages } =
    useI18n();
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    semesterId: '',
    courseId: '',
    sectionId: '',
    status: '',
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedEnrollment, setSelectedEnrollment] = useState<Enrollment | null>(
    null,
  );
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push(href('/dashboard'));
    }
  }, [href, isAdmin, isSuperAdmin, router, user]);

  const fetchDropdownData = useCallback(async () => {
    try {
      const [semestersResponse, coursesResponse] = await Promise.all([
        semestersApi.getAll(),
        coursesApi.getAll({ limit: 1000 }),
      ]);
      setSemesters(semestersResponse.data || []);
      setCourses(coursesResponse.data || []);
    } catch {
      // Optional filter data.
    }
  }, []);

  const fetchSectionsForCourse = useCallback(async (courseId: string) => {
    if (!courseId) {
      setSections([]);
      return;
    }

    try {
      const response = await sectionsApi.getAll({ courseId, limit: 100 });
      setSections(response.data || []);
    } catch {
      setSections([]);
    }
  }, []);

  const fetchEnrollments = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const params: {
        page: number;
        limit: number;
        semesterId?: string;
        courseId?: string;
        sectionId?: string;
        status?: string;
      } = { page, limit: 20 };
      if (filters.semesterId) params.semesterId = filters.semesterId;
      if (filters.courseId) params.courseId = filters.courseId;
      if (filters.sectionId) params.sectionId = filters.sectionId;
      if (filters.status) params.status = filters.status;

      const response = await enrollmentsApi.getAll(params);
      setEnrollments(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
      setTotal(response.meta?.total || 0);
    } catch {
      setError(
        locale === 'vi'
          ? 'Hiện chưa thể tải danh sách đăng ký.'
          : 'Enrollments could not be loaded.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [filters.courseId, filters.sectionId, filters.semesterId, filters.status, locale, page]);

  const copy =
    locale === 'vi'
      ? {
          loading: 'Đang tải đăng ký',
          title: 'Đăng ký học phần',
          description:
            'Theo dõi luồng đăng ký, phát hiện lệch trạng thái và xem chi tiết đăng ký theo section từ một nơi.',
          exportCsv: 'Xuất CSV',
          semester: 'Học kỳ',
          course: 'Môn học',
          section: 'Section',
          status: 'Trạng thái',
          allSemesters: 'Tất cả học kỳ',
          allCourses: 'Tất cả môn học',
          allSections: 'Tất cả section',
          allStatuses: 'Tất cả trạng thái',
          statusOptions: {
            PENDING: 'Chờ xác nhận',
            CONFIRMED: 'Đã xác nhận',
            COMPLETED: 'Hoàn tất',
            DROPPED: 'Đã rút',
            CANCELLED: 'Đã hủy',
          },
          clearFilters: 'Xóa bộ lọc',
          enrollmentsCount: (count: number) => `${formatNumber(count)} đăng ký`,
          unavailableTitle: 'Đăng ký chưa sẵn sàng',
          emptyTitle: 'Không có đăng ký phù hợp',
          emptyDescription:
            'Khi sinh viên bắt đầu đăng ký, màn hình này sẽ hiển thị môn học, section, học kỳ và trạng thái cuối cùng trong cùng một nơi.',
          tableTitle: 'Bản ghi đăng ký',
          pageSummary: (currentPage: number, pages: number) =>
            `Trang ${currentPage} / ${pages}`,
          headers: {
            student: 'Sinh viên',
            course: 'Môn học',
            section: 'Section',
            semester: 'Học kỳ',
            lecturer: 'Giảng viên',
            status: 'Trạng thái',
            enrolledDate: 'Ngày đăng ký',
            actions: 'Tác vụ',
          },
          noEmail: 'Chưa có email',
          unknownCourse: 'Chưa rõ môn học',
          noCourseName: 'Chưa có tên môn',
          unknownSection: 'Chưa rõ section',
          unassigned: 'Chưa gán',
          viewDetail: 'Chi tiết đăng ký',
          closeDetail: 'Đóng chi tiết đăng ký',
          deleteTitle: 'Xóa đăng ký',
          deleteMessage: (learnerLabel: string) =>
            `Xóa đăng ký của ${learnerLabel}? Hành động này không thể hoàn tác.`,
          deleteConfirm: 'Xóa đăng ký',
          deleted: 'Đã xóa đăng ký',
          deleteFailed: 'Hiện chưa thể xóa đăng ký này.',
          exportStarted: 'Đã bắt đầu xuất dữ liệu đăng ký',
          exportFailed: 'Hiện chưa thể xuất dữ liệu đăng ký.',
          detailFailed: 'Hiện chưa thể tải chi tiết đăng ký.',
          viewLabel: (learnerLabel: string) =>
            `Xem chi tiết đăng ký của ${learnerLabel}`,
          deleteLabel: (learnerLabel: string) =>
            `Xóa đăng ký của ${learnerLabel}`,
          detail: {
            title: 'Chi tiết đăng ký',
            student: 'Sinh viên',
            status: 'Trạng thái',
            course: 'Môn học',
            section: 'Section',
            semester: 'Học kỳ',
            lecturer: 'Giảng viên',
            enrolledAt: 'Đăng ký lúc',
            droppedAt: 'Rút lúc',
            finalGrade: 'Điểm cuối kỳ',
            letterGrade: 'Điểm chữ',
            close: 'Đóng',
          },
        }
      : {
          loading: 'Loading enrollments',
          title: 'Enrollments',
          description:
            'Track registration flow, identify status drift, and review section-level enrollment details from one place.',
          exportCsv: 'Export CSV',
          semester: 'Semester',
          course: 'Course',
          section: 'Section',
          status: 'Status',
          allSemesters: 'All semesters',
          allCourses: 'All courses',
          allSections: 'All sections',
          allStatuses: 'All statuses',
          statusOptions: {
            PENDING: 'Pending',
            CONFIRMED: 'Confirmed',
            COMPLETED: 'Completed',
            DROPPED: 'Dropped',
            CANCELLED: 'Cancelled',
          },
          clearFilters: 'Clear filters',
          enrollmentsCount: (count: number) => `${formatNumber(count)} enrollments`,
          unavailableTitle: 'Enrollments unavailable',
          emptyTitle: 'No matching enrollments',
          emptyDescription:
            'When students start registering, this view will show course, section, semester, and final status in one place.',
          tableTitle: 'Enrollment records',
          pageSummary: (currentPage: number, pages: number) =>
            `Page ${currentPage} of ${pages}`,
          headers: {
            student: 'Student',
            course: 'Course',
            section: 'Section',
            semester: 'Semester',
            lecturer: 'Lecturer',
            status: 'Status',
            enrolledDate: 'Enrolled date',
            actions: 'Actions',
          },
          noEmail: 'No email',
          unknownCourse: 'Unknown course',
          noCourseName: 'No course name',
          unknownSection: 'Unknown section',
          unassigned: 'Unassigned',
          viewDetail: 'Enrollment details',
          closeDetail: 'Close enrollment details',
          deleteTitle: 'Delete enrollment',
          deleteMessage: (learnerLabel: string) =>
            `Delete ${learnerLabel}'s enrollment? This action cannot be undone.`,
          deleteConfirm: 'Delete enrollment',
          deleted: 'Enrollment deleted',
          deleteFailed: 'We could not delete that enrollment.',
          exportStarted: 'Enrollment export started',
          exportFailed: 'Enrollments could not be exported.',
          detailFailed: 'Enrollment details could not be loaded.',
          viewLabel: (learnerLabel: string) =>
            `View enrollment details for ${learnerLabel}`,
          deleteLabel: (learnerLabel: string) =>
            `Delete enrollment for ${learnerLabel}`,
          detail: {
            title: 'Enrollment details',
            student: 'Student',
            status: 'Status',
            course: 'Course',
            section: 'Section',
            semester: 'Semester',
            lecturer: 'Lecturer',
            enrolledAt: 'Enrolled at',
            droppedAt: 'Dropped at',
            finalGrade: 'Final grade',
            letterGrade: 'Letter grade',
            close: 'Close',
          },
        };

  useEffect(() => {
    if (canAccess) {
      void fetchDropdownData();
      void fetchEnrollments();
    }
  }, [canAccess, fetchDropdownData, fetchEnrollments]);

  useEffect(() => {
    if (canAccess) {
      void fetchSectionsForCourse(filters.courseId);
    }
  }, [canAccess, fetchSectionsForCourse, filters.courseId]);

  const semesterOptions = useMemo(
    () => [
      { value: '', label: copy.allSemesters },
      ...semesters.map((semester) => ({
        value: semester.id,
        label: semester.name,
      })),
    ],
    [copy.allSemesters, semesters],
  );

  const courseOptions = useMemo(
    () => [
      { value: '', label: copy.allCourses },
      ...courses.map((course) => ({
        value: course.id,
        label: `${course.code} - ${course.name}`,
      })),
    ],
    [copy.allCourses, courses],
  );

  const sectionOptions = useMemo(
    () => [
      { value: '', label: copy.allSections },
      ...sections.map((section) => ({
        value: section.id,
        label: section.sectionNumber,
      })),
    ],
    [copy.allSections, sections],
  );

  const statusOptions = useMemo(
    () => [
      { value: '', label: copy.allStatuses },
      { value: 'PENDING', label: copy.statusOptions.PENDING },
      { value: 'CONFIRMED', label: copy.statusOptions.CONFIRMED },
      { value: 'COMPLETED', label: copy.statusOptions.COMPLETED },
      { value: 'DROPPED', label: copy.statusOptions.DROPPED },
      { value: 'CANCELLED', label: copy.statusOptions.CANCELLED },
    ],
    [copy.allStatuses, copy.statusOptions],
  );

  if (!canAccess) {
    return <LoadingState label={copy.loading} className="m-8" />;
  }

  const handleClearFilters = () => {
    setFilters({ semesterId: '', courseId: '', sectionId: '', status: '' });
    setPage(1);
  };

  const handleViewDetail = async (enrollment: Enrollment) => {
    try {
      const fullEnrollment = await enrollmentsApi.getById(enrollment.id);
      setSelectedEnrollment(fullEnrollment);
      setIsDetailOpen(true);
    } catch {
      toast.error(copy.detailFailed);
    }
  };

  const handleDelete = async (enrollment: Enrollment) => {
    const learnerLabel = enrollment.student?.user
      ? `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`
      : enrollment.studentId;

    const shouldDelete = await confirm({
      title: copy.deleteTitle,
      message: copy.deleteMessage(learnerLabel),
      confirmText: copy.deleteConfirm,
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await enrollmentsApi.delete(enrollment.id);
      toast.success(copy.deleted);
      await fetchEnrollments();
    } catch {
      toast.error(copy.deleteFailed);
    }
  };

  const handleExportCsv = async () => {
    try {
      const csvData = await enrollmentsApi.exportCsv(filters);
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `enrollments_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      toast.success(copy.exportStarted);
    } catch {
      toast.error(copy.exportFailed);
    }
  };

  return (
    <AdminFrame
      title={copy.title}
      description={copy.description}
      actions={
        <Button variant="outline" onClick={() => void handleExportCsv()}>
          <Download className="mr-2 h-4 w-4" />
          {copy.exportCsv}
        </Button>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <div className="grid gap-4 xl:grid-cols-5">
              <Select
                label={copy.semester}
                value={filters.semesterId}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    semesterId: event.target.value,
                  }));
                  setPage(1);
                }}
                options={semesterOptions}
              />
              <Select
                label={copy.course}
                value={filters.courseId}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    courseId: event.target.value,
                    sectionId: '',
                  }));
                  setPage(1);
                }}
                options={courseOptions}
              />
              <Select
                label={copy.section}
                value={filters.sectionId}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    sectionId: event.target.value,
                  }));
                  setPage(1);
                }}
                options={sectionOptions}
                disabled={!filters.courseId}
              />
              <Select
                label={copy.status}
                value={filters.status}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    status: event.target.value,
                  }));
                  setPage(1);
                }}
                options={statusOptions}
              />
              <div className="flex items-end gap-2">
                <Button variant="outline" onClick={handleClearFilters}>
                  {copy.clearFilters}
                </Button>
                <div className="text-sm text-muted-foreground">
                  {copy.enrollmentsCount(total)}
                </div>
              </div>
            </div>
        </AdminToolbarCard>

        {error ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={error}
            onRetry={() => void fetchEnrollments()}
          />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : enrollments.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={copy.emptyTitle}
            description={copy.emptyDescription}
          />
        ) : (
          <AdminTableCard
            title={copy.tableTitle}
            footer={
              <AdminPaginationFooter
                summary={copy.pageSummary(page, totalPages)}
                page={page}
                totalPages={totalPages}
                onPrevious={() => setPage((current) => current - 1)}
                onNext={() => setPage((current) => current + 1)}
              />
            }
          >
              <AdminTableScroll>
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">{copy.headers.student}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.course}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.section}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.semester}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.lecturer}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.status}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.enrolledDate}</th>
                      <th className="px-2 py-3 text-right font-medium">{copy.headers.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {enrollments.map((enrollment) => {
                      const learnerLabel = enrollment.student?.user
                        ? `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`
                        : enrollment.studentId;

                      return (
                        <tr key={enrollment.id}>
                          <td className="px-2 py-4">
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">
                                {learnerLabel}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {enrollment.student?.user?.email || copy.noEmail}
                              </p>
                            </div>
                          </td>
                          <td className="px-2 py-4">
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">
                                {enrollment.section?.course?.code || copy.unknownCourse}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {enrollment.section?.course?.name || copy.noCourseName}
                              </p>
                            </div>
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {enrollment.section?.sectionNumber || copy.unknownSection}
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {enrollment.semester?.name || copy.unassigned}
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {enrollment.section?.lecturer?.user
                              ? `${enrollment.section.lecturer.user.firstName} ${enrollment.section.lecturer.user.lastName}`
                              : copy.unassigned}
                          </td>
                          <td className="px-2 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[enrollment.status] || 'bg-secondary text-foreground'}`}
                            >
                              {copy.statusOptions[enrollment.status as keyof typeof copy.statusOptions] ??
                                enrollment.status}
                            </span>
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {formatDate(enrollment.enrolledAt)}
                          </td>
                          <td className="px-2 py-4">
                            <AdminRowActions>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => void handleViewDetail(enrollment)}
                                aria-label={copy.viewLabel(learnerLabel)}
                                title={copy.viewLabel(learnerLabel)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => void handleDelete(enrollment)}
                                aria-label={copy.deleteLabel(learnerLabel)}
                                title={copy.deleteLabel(learnerLabel)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AdminRowActions>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </AdminTableScroll>
          </AdminTableCard>
        )}
      </div>

      <Modal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        title={copy.detail.title}
        closeLabel={copy.closeDetail}
        className="max-w-2xl"
      >
        {selectedEnrollment ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.student}
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.student?.user?.firstName}{' '}
                  {selectedEnrollment.student?.user?.lastName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedEnrollment.student?.user?.email || copy.noEmail}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.status}
                </label>
                <div className="mt-1">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[selectedEnrollment.status] || 'bg-secondary text-foreground'}`}
                  >
                    {copy.statusOptions[
                      selectedEnrollment.status as keyof typeof copy.statusOptions
                    ] ?? selectedEnrollment.status}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.course}
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.section?.course?.code} -{' '}
                  {selectedEnrollment.section?.course?.name}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.section}
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.section?.sectionNumber}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.semester}
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.semester?.name || copy.unassigned}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.lecturer}
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.section?.lecturer?.user
                    ? `${selectedEnrollment.section.lecturer.user.firstName} ${selectedEnrollment.section.lecturer.user.lastName}`
                    : copy.unassigned}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.enrolledAt}
                </label>
                <p className="mt-1 text-foreground">
                  {formatDateTime(selectedEnrollment.enrolledAt)}
                </p>
              </div>
              {selectedEnrollment.droppedAt ? (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {copy.detail.droppedAt}
                  </label>
                  <p className="mt-1 text-foreground">
                    {formatDateTime(selectedEnrollment.droppedAt)}
                  </p>
                </div>
              ) : null}
            </div>

            {selectedEnrollment.finalGrade ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {copy.detail.finalGrade}
                  </label>
                  <p className="mt-1 text-foreground">
                    {formatNumber(selectedEnrollment.finalGrade)}
                  </p>
                </div>
                {selectedEnrollment.letterGrade ? (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {copy.detail.letterGrade}
                    </label>
                    <p className="mt-1 text-foreground">
                      {selectedEnrollment.letterGrade}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <AdminDialogFooter className="pt-0">
              <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
                {copy.detail.close}
              </Button>
            </AdminDialogFooter>
          </div>
        ) : null}
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
