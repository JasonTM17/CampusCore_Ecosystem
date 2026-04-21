'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { coursesApi, departmentsApi } from '@/lib/api';
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
import { Textarea } from '@/components/ui/textarea';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';

interface Course {
  id: string;
  code: string;
  name: string;
  credits: number;
  departmentId: string;
  department?: { name: string };
  isActive: boolean;
}

interface Department {
  id: string;
  name: string;
}

export default function AdminCoursesPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    credits: 3,
    departmentId: '',
    description: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchDepartments = useCallback(async () => {
    try {
      const response = await departmentsApi.getAll({ limit: 1000 });
      setDepartments(response.data || []);
    } catch {
      // Filter options are optional in this view.
    }
  }, []);

  const fetchCourses = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await coursesApi.getAll({
        page,
        limit: 20,
        departmentId: departmentFilter || undefined,
      });
      const filteredCourses = search
        ? response.data.filter(
            (course: Course) =>
              course.code.toLowerCase().includes(search.toLowerCase()) ||
              course.name.toLowerCase().includes(search.toLowerCase()),
          )
        : response.data;

      setCourses(filteredCourses);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError('Courses could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [departmentFilter, page, search]);

  useEffect(() => {
    if (canAccess) {
      void fetchDepartments();
      void fetchCourses();
    }
  }, [canAccess, fetchCourses, fetchDepartments]);

  const pageSummary = useMemo(() => {
    if (courses.length === 0) {
      return 'No matching records';
    }

    return `Page ${page} of ${totalPages}`;
  }, [courses.length, page, totalPages]);

  const departmentOptions = useMemo(
    () => [
      { value: '', label: 'All departments' },
      ...departments.map((department) => ({
        value: department.id,
        label: department.name,
      })),
    ],
    [departments],
  );

  const formDepartmentOptions = useMemo(
    () => [
      { value: '', label: 'Select department' },
      ...departments.map((department) => ({
        value: department.id,
        label: department.name,
      })),
    ],
    [departments],
  );

  if (!canAccess) {
    return <LoadingState label="Loading courses" className="m-8" />;
  }

  const resetForm = () => {
    setEditingCourse(null);
    setFormData({
      code: '',
      name: '',
      credits: 3,
      departmentId: '',
      description: '',
    });
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (course: Course) => {
    setEditingCourse(course);
    setFormData({
      code: course.code,
      name: course.name,
      credits: course.credits,
      departmentId: course.departmentId,
      description: '',
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
    await fetchCourses();
  };

  const handleDelete = async (course: Course) => {
    const shouldDelete = await confirm({
      title: 'Delete course',
      message: `Delete ${course.code}? This removes the course from the current admin view.`,
      confirmText: 'Delete course',
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await coursesApi.delete(course.id);
      toast.success('Course deleted');
      await fetchCourses();
    } catch {
      toast.error('We could not delete that course.');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      if (editingCourse) {
        await coursesApi.update(editingCourse.id, formData);
        toast.success('Course updated');
      } else {
        await coursesApi.create(formData);
        toast.success('Course created');
      }

      closeModal();
      await fetchCourses();
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ?? 'The course could not be saved.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminFrame
      title="Courses"
      description="Maintain the course catalog with clean ownership, clear credit values, and a consistent academic structure."
      backLabel="Back to admin dashboard"
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create course
        </Button>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <form
              onSubmit={handleSearch}
              className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"
            >
              <div className="grid w-full gap-4 xl:max-w-3xl xl:grid-cols-[minmax(0,1fr)_260px]">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    Search courses
                  </label>
                  <Input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search by code or name"
                    icon={<Search className="h-4 w-4" />}
                  />
                </div>
                <Select
                  label="Department"
                  value={departmentFilter}
                  onChange={(event) => {
                    setDepartmentFilter(event.target.value);
                    setPage(1);
                  }}
                  options={departmentOptions}
                />
              </div>
              <AdminToolbarMeta
                summary={pageSummary}
                actions={
                  <Button type="submit" variant="outline">
                    Search
                  </Button>
                }
              />
            </form>
        </AdminToolbarCard>

        {error ? (
          <ErrorState
            title="Courses unavailable"
            description={error}
            onRetry={() => void fetchCourses()}
          />
        ) : isLoading ? (
          <LoadingState label="Loading courses" />
        ) : courses.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No matching courses"
            description="Create a course so sections, registration, and finance flows inherit a clean catalog source."
            action={<Button onClick={openCreate}>Create course</Button>}
          />
        ) : (
          <AdminTableCard
            title="Course records"
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
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">Code</th>
                      <th className="px-2 py-3 font-medium">Name</th>
                      <th className="px-2 py-3 font-medium">Credits</th>
                      <th className="px-2 py-3 font-medium">Department</th>
                      <th className="px-2 py-3 font-medium">Status</th>
                      <th className="px-2 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {courses.map((course) => (
                      <tr key={course.id}>
                        <td className="px-2 py-4 font-medium text-foreground">
                          {course.code}
                        </td>
                        <td className="px-2 py-4 text-foreground">
                          {course.name}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {course.credits}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {course.department?.name || 'Unassigned'}
                        </td>
                        <td className="px-2 py-4">
                          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            {course.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(course)}
                              aria-label={`Edit course ${course.code}`}
                              title={`Edit course ${course.code}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(course)}
                              aria-label={`Delete course ${course.code}`}
                              title={`Delete course ${course.code}`}
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
        title={editingCourse ? 'Edit course' : 'Create course'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label="Course code">
              <Input
                type="text"
                value={formData.code}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
                disabled={Boolean(editingCourse)}
                required
              />
            </AdminFormField>
            <AdminFormField label="Credits">
              <Input
                type="number"
                min="1"
                max="12"
                value={formData.credits}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    credits: Number(event.target.value) || 3,
                  }))
                }
                required
              />
            </AdminFormField>
          </div>

          <AdminFormField label="Course name">
            <Input
              type="text"
              value={formData.name}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              required
            />
          </AdminFormField>

          <Select
            label="Department"
            value={formData.departmentId}
            onChange={(event) =>
              setFormData((current) => ({
                ...current,
                departmentId: event.target.value,
              }))
            }
            options={formDepartmentOptions}
            required
          />

          <AdminFormField label="Description">
            <Textarea
              value={formData.description}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={4}
              placeholder="Optional catalog notes"
            />
          </AdminFormField>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? 'Saving...'
                : editingCourse
                  ? 'Save changes'
                  : 'Create course'}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
