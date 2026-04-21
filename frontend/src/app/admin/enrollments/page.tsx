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
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

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
      setError('Enrollments could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [filters.courseId, filters.sectionId, filters.semesterId, filters.status, page]);

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
      { value: '', label: 'All semesters' },
      ...semesters.map((semester) => ({
        value: semester.id,
        label: semester.name,
      })),
    ],
    [semesters],
  );

  const courseOptions = useMemo(
    () => [
      { value: '', label: 'All courses' },
      ...courses.map((course) => ({
        value: course.id,
        label: `${course.code} - ${course.name}`,
      })),
    ],
    [courses],
  );

  const sectionOptions = useMemo(
    () => [
      { value: '', label: 'All sections' },
      ...sections.map((section) => ({
        value: section.id,
        label: section.sectionNumber,
      })),
    ],
    [sections],
  );

  const statusOptions = useMemo(
    () => [
      { value: '', label: 'All statuses' },
      { value: 'PENDING', label: 'Pending' },
      { value: 'CONFIRMED', label: 'Confirmed' },
      { value: 'COMPLETED', label: 'Completed' },
      { value: 'DROPPED', label: 'Dropped' },
      { value: 'CANCELLED', label: 'Cancelled' },
    ],
    [],
  );

  if (!canAccess) {
    return <LoadingState label="Loading enrollments" className="m-8" />;
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
      toast.error('Enrollment details could not be loaded.');
    }
  };

  const handleDelete = async (enrollment: Enrollment) => {
    const learnerLabel = enrollment.student?.user
      ? `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`
      : enrollment.studentId;

    const shouldDelete = await confirm({
      title: 'Delete enrollment',
      message: `Delete ${learnerLabel}'s enrollment? This action cannot be undone.`,
      confirmText: 'Delete enrollment',
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await enrollmentsApi.delete(enrollment.id);
      toast.success('Enrollment deleted');
      await fetchEnrollments();
    } catch {
      toast.error('We could not delete that enrollment.');
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
      toast.success('Enrollment export started');
    } catch {
      toast.error('Enrollments could not be exported.');
    }
  };

  return (
    <AdminFrame
      title="Enrollments"
      description="Track registration flow, identify status drift, and review section-level enrollment details from one place."
      backLabel="Back to admin dashboard"
      actions={
        <Button variant="outline" onClick={() => void handleExportCsv()}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <div className="grid gap-4 xl:grid-cols-5">
              <Select
                label="Semester"
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
                label="Course"
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
                label="Section"
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
                label="Status"
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
                  Clear filters
                </Button>
                <div className="text-sm text-muted-foreground">
                  {total} enrollments
                </div>
              </div>
            </div>
        </AdminToolbarCard>

        {error ? (
          <ErrorState
            title="Enrollments unavailable"
            description={error}
            onRetry={() => void fetchEnrollments()}
          />
        ) : isLoading ? (
          <LoadingState label="Loading enrollments" />
        ) : enrollments.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No matching enrollments"
            description="When students start registering, this view will show course, section, semester, and final status in one place."
          />
        ) : (
          <AdminTableCard
            title="Enrollment records"
            footer={
              <AdminPaginationFooter
                summary={`Page ${page} of ${totalPages}`}
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
                      <th className="px-2 py-3 font-medium">Student</th>
                      <th className="px-2 py-3 font-medium">Course</th>
                      <th className="px-2 py-3 font-medium">Section</th>
                      <th className="px-2 py-3 font-medium">Semester</th>
                      <th className="px-2 py-3 font-medium">Lecturer</th>
                      <th className="px-2 py-3 font-medium">Status</th>
                      <th className="px-2 py-3 font-medium">Enrolled date</th>
                      <th className="px-2 py-3 text-right font-medium">Actions</th>
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
                                {enrollment.student?.user?.email || 'No email'}
                              </p>
                            </div>
                          </td>
                          <td className="px-2 py-4">
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">
                                {enrollment.section?.course?.code || 'Unknown course'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {enrollment.section?.course?.name || 'No course name'}
                              </p>
                            </div>
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {enrollment.section?.sectionNumber || 'Unknown section'}
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {enrollment.semester?.name || 'Unassigned'}
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {enrollment.section?.lecturer?.user
                              ? `${enrollment.section.lecturer.user.firstName} ${enrollment.section.lecturer.user.lastName}`
                              : 'Unassigned'}
                          </td>
                          <td className="px-2 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[enrollment.status] || 'bg-secondary text-foreground'}`}
                            >
                              {enrollment.status}
                            </span>
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {new Date(enrollment.enrolledAt).toLocaleDateString()}
                          </td>
                          <td className="px-2 py-4">
                            <AdminRowActions>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => void handleViewDetail(enrollment)}
                                aria-label={`View enrollment details for ${learnerLabel}`}
                                title={`View enrollment details for ${learnerLabel}`}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => void handleDelete(enrollment)}
                                aria-label={`Delete enrollment for ${learnerLabel}`}
                                title={`Delete enrollment for ${learnerLabel}`}
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
        title="Enrollment details"
        closeLabel="Close enrollment details"
        className="max-w-2xl"
      >
        {selectedEnrollment ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Student
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.student?.user?.firstName}{' '}
                  {selectedEnrollment.student?.user?.lastName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedEnrollment.student?.user?.email || 'No email'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Status
                </label>
                <div className="mt-1">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[selectedEnrollment.status] || 'bg-secondary text-foreground'}`}
                  >
                    {selectedEnrollment.status}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Course
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.section?.course?.code} -{' '}
                  {selectedEnrollment.section?.course?.name}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Section
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.section?.sectionNumber}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Semester
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.semester?.name || 'Unassigned'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Lecturer
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.section?.lecturer?.user
                    ? `${selectedEnrollment.section.lecturer.user.firstName} ${selectedEnrollment.section.lecturer.user.lastName}`
                    : 'Unassigned'}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Enrolled at
                </label>
                <p className="mt-1 text-foreground">
                  {new Date(selectedEnrollment.enrolledAt).toLocaleString()}
                </p>
              </div>
              {selectedEnrollment.droppedAt ? (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Dropped at
                  </label>
                  <p className="mt-1 text-foreground">
                    {new Date(selectedEnrollment.droppedAt).toLocaleString()}
                  </p>
                </div>
              ) : null}
            </div>

            {selectedEnrollment.finalGrade ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Final grade
                  </label>
                  <p className="mt-1 text-foreground">
                    {selectedEnrollment.finalGrade}
                  </p>
                </div>
                {selectedEnrollment.letterGrade ? (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Letter grade
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
                Close
              </Button>
            </AdminDialogFooter>
          </div>
        ) : null}
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
