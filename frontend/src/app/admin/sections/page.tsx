'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  adminSectionsApi,
  adminSemestersApi,
  classroomsApi,
  coursesApi,
  lecturersApi,
} from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminDialogFooter,
  AdminFormField,
  AdminFormSection,
  AdminPaginationFooter,
  AdminRowActions,
  AdminTableCard,
  AdminTableScroll,
  AdminToolbarCard,
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

const dayNames = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

interface Section {
  id: string;
  sectionNumber: string;
  courseId: string;
  semesterId: string;
  lecturerId?: string;
  capacity: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  course?: { code: string; name: string; department?: { name: string } };
  semester?: { name: string };
  lecturer?: { user?: { firstName: string; lastName: string } };
  schedules?: {
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    classroom?: { id?: string; building: string; roomNumber: string };
  }[];
}

interface Course {
  id: string;
  code: string;
  name: string;
}

interface Semester {
  id: string;
  name: string;
}

interface Lecturer {
  id: string;
  employeeId: string;
  user?: { firstName: string; lastName: string };
}

interface Classroom {
  id: string;
  building: string;
  roomNumber: string;
}

interface ScheduleEntry {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  classroomId: string;
}

const sectionStatuses = ['OPEN', 'CLOSED', 'CANCELLED'] as const;
type SectionStatus = (typeof sectionStatuses)[number];

function isSectionStatus(value: string): value is SectionStatus {
  return sectionStatuses.includes(value as SectionStatus);
}

export default function AdminSectionsPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [sections, setSections] = useState<Section[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    courseId: '',
    semesterId: '',
    sectionNumber: '',
    capacity: 30,
    status: 'OPEN',
    lecturerId: '',
  });
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchDropdownData = useCallback(async () => {
    try {
      const [
        coursesResponse,
        semestersResponse,
        lecturersResponse,
        classroomsResponse,
      ] = await Promise.all([
        coursesApi.getAll({ limit: 1000 }),
        adminSemestersApi.getAll({ limit: 1000 }),
        lecturersApi.getAll({ limit: 1000 }),
        classroomsApi.getAll({ limit: 1000 }),
      ]);
      setCourses(coursesResponse.data || []);
      setSemesters(semestersResponse.data || []);
      setLecturers(lecturersResponse.data || []);
      setClassrooms(classroomsResponse.data || []);
    } catch {
      // Reference data is best effort.
    }
  }, []);

  const fetchSections = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await adminSectionsApi.getAll({
        page,
        limit: 20,
        semesterId: semesterFilter || undefined,
      });
      setSections(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError('Sections could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [page, semesterFilter]);

  useEffect(() => {
    if (canAccess) {
      void fetchDropdownData();
      void fetchSections();
    }
  }, [canAccess, fetchDropdownData, fetchSections]);

  const semesterFilterOptions = useMemo(
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
      { value: '', label: 'Select course' },
      ...courses.map((course) => ({
        value: course.id,
        label: `${course.code} - ${course.name}`,
      })),
    ],
    [courses],
  );

  const semesterOptions = useMemo(
    () => [
      { value: '', label: 'Select semester' },
      ...semesters.map((semester) => ({
        value: semester.id,
        label: semester.name,
      })),
    ],
    [semesters],
  );

  const lecturerOptions = useMemo(
    () => [
      { value: '', label: 'No lecturer assigned' },
      ...lecturers.map((lecturer) => ({
        value: lecturer.id,
        label: lecturer.user
          ? `${lecturer.user.firstName} ${lecturer.user.lastName} (${lecturer.employeeId})`
          : lecturer.employeeId,
      })),
    ],
    [lecturers],
  );

  const classroomOptions = useMemo(
    () => [
      { value: '', label: 'Select room' },
      ...classrooms.map((classroom) => ({
        value: classroom.id,
        label: `${classroom.building} ${classroom.roomNumber}`,
      })),
    ],
    [classrooms],
  );

  if (!canAccess) {
    return <LoadingState label="Loading sections" className="m-8" />;
  }

  const resetForm = () => {
    setEditingSection(null);
    setFormData({
      courseId: '',
      semesterId: '',
      sectionNumber: '',
      capacity: 30,
      status: 'OPEN',
      lecturerId: '',
    });
    setSchedules([]);
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = async (section: Section) => {
    setEditingSection(section);
    setFormData({
      courseId: section.courseId,
      semesterId: section.semesterId,
      sectionNumber: section.sectionNumber,
      capacity: section.capacity,
      status: section.status,
      lecturerId: section.lecturerId || '',
    });

    try {
      const fullSection = await adminSectionsApi.getById(section.id);
      setSchedules(
        (fullSection.schedules || []).map((schedule) => ({
          dayOfWeek: schedule.dayOfWeek,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          classroomId: schedule.classroom?.id || '',
        })),
      );
    } catch {
      setSchedules([]);
    }

    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const handleDelete = async (section: Section) => {
    const shouldDelete = await confirm({
      title: 'Delete section',
      message: `Delete section ${section.sectionNumber} for ${section.course?.code || 'this course'}?`,
      confirmText: 'Delete section',
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await adminSectionsApi.delete(section.id);
      toast.success('Section deleted');
      await fetchSections();
    } catch {
      toast.error('We could not delete that section.');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const payload = {
        ...formData,
        capacity: Number(formData.capacity),
        schedules: schedules.length > 0 ? schedules : undefined,
      };

      if (editingSection) {
        await adminSectionsApi.update(editingSection.id, payload);
        toast.success('Section updated');
      } else {
        await adminSectionsApi.create(payload);
        toast.success('Section created');
      }

      closeModal();
      await fetchSections();
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ?? 'The section could not be saved.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const addSchedule = () => {
    setSchedules((current) => [
      ...current,
      { dayOfWeek: 1, startTime: '09:00', endTime: '10:30', classroomId: '' },
    ]);
  };

  const removeSchedule = (index: number) => {
    setSchedules((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const updateSchedule = (
    index: number,
    field: keyof ScheduleEntry,
    value: string | number,
  ) => {
    setSchedules((current) =>
      current.map((schedule, currentIndex) =>
        currentIndex === index ? { ...schedule, [field]: value } : schedule,
      ),
    );
  };

  return (
    <AdminFrame
      title="Sections"
      description="Control section capacity, teaching assignments, and classroom schedules from one consistent workflow."
      backLabel="Back to admin dashboard"
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create section
        </Button>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="w-full max-w-sm">
                <Select
                  label="Semester"
                  value={semesterFilter}
                  onChange={(event) => {
                    setSemesterFilter(event.target.value);
                    setPage(1);
                  }}
                  options={semesterFilterOptions}
                />
              </div>
              <div className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </div>
            </div>
        </AdminToolbarCard>

        {error ? (
          <ErrorState
            title="Sections unavailable"
            description={error}
            onRetry={() => void fetchSections()}
          />
        ) : isLoading ? (
          <LoadingState label="Loading sections" />
        ) : sections.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No matching sections"
            description="Create a section to connect course inventory, lecturer assignment, and room scheduling into one record."
            action={<Button onClick={openCreate}>Create section</Button>}
          />
        ) : (
          <AdminTableCard
            title="Section records"
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
                <table className="w-full min-w-[1120px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">Course</th>
                      <th className="px-2 py-3 font-medium">Section</th>
                      <th className="px-2 py-3 font-medium">Semester</th>
                      <th className="px-2 py-3 font-medium">Lecturer</th>
                      <th className="px-2 py-3 font-medium">Capacity</th>
                      <th className="px-2 py-3 font-medium">Schedule</th>
                      <th className="px-2 py-3 font-medium">Status</th>
                      <th className="px-2 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {sections.map((section) => (
                      <tr key={section.id}>
                        <td className="px-2 py-4">
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">
                              {section.course?.code || 'Unknown course'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {section.course?.name || 'No course name'}
                            </p>
                          </div>
                        </td>
                        <td className="px-2 py-4 text-foreground">
                          {section.sectionNumber}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {section.semester?.name || 'Unassigned'}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {section.lecturer?.user
                            ? `${section.lecturer.user.firstName} ${section.lecturer.user.lastName}`
                            : 'Unassigned'}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {section.capacity}
                        </td>
                        <td className="px-2 py-4">
                          {section.schedules && section.schedules.length > 0 ? (
                            <div className="space-y-1">
                              {section.schedules.map((schedule, index) => (
                                <div key={schedule.id || index} className="text-xs">
                                  <span className="font-medium text-foreground">
                                    {dayNames[schedule.dayOfWeek]}
                                  </span>{' '}
                                  <span className="text-muted-foreground">
                                    {schedule.startTime}-{schedule.endTime}
                                  </span>{' '}
                                  <span className="text-muted-foreground">
                                    {schedule.classroom?.building}
                                    {schedule.classroom?.roomNumber
                                      ? ` ${schedule.classroom.roomNumber}`
                                      : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              No schedule
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-4">
                          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            {section.status}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => void openEdit(section)}
                              aria-label={`Edit section ${section.sectionNumber} for ${section.course?.code || 'course'}`}
                              title={`Edit section ${section.sectionNumber} for ${section.course?.code || 'course'}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(section)}
                              aria-label={`Delete section ${section.sectionNumber} for ${section.course?.code || 'course'}`}
                              title={`Delete section ${section.sectionNumber} for ${section.course?.code || 'course'}`}
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
        title={editingSection ? 'Edit section' : 'Create section'}
        className="max-w-3xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Course"
              value={formData.courseId}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  courseId: event.target.value,
                }))
              }
              options={courseOptions}
              required
            />
            <Select
              label="Semester"
              value={formData.semesterId}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  semesterId: event.target.value,
                }))
              }
              options={semesterOptions}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <AdminFormField label="Section number">
              <Input
                type="text"
                value={formData.sectionNumber}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    sectionNumber: event.target.value,
                  }))
                }
                required
              />
            </AdminFormField>
            <AdminFormField label="Capacity">
              <Input
                type="number"
                min="1"
                value={formData.capacity}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    capacity: Number(event.target.value) || 30,
                  }))
                }
                required
              />
            </AdminFormField>
            <Select
              label="Status"
              value={formData.status}
              onChange={(event) => {
                const nextStatus = event.target.value;
                if (isSectionStatus(nextStatus)) {
                  setFormData((current) => ({
                    ...current,
                    status: nextStatus,
                  }));
                }
              }}
              options={sectionStatuses.map((status) => ({
                value: status,
                label: status,
              }))}
            />
          </div>

          <Select
            label="Lecturer"
            value={formData.lecturerId}
            onChange={(event) =>
              setFormData((current) => ({
                ...current,
                lecturerId: event.target.value,
              }))
            }
            options={lecturerOptions}
          />

          <AdminFormSection
            title="Schedules"
            description="Add meeting times only when the section already has a reliable semester, room, and ownership context."
          >
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={addSchedule}>
                <Plus className="mr-2 h-4 w-4" />
                Add schedule
              </Button>
            </div>

            {schedules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/80 bg-secondary/20 px-4 py-6 text-sm text-muted-foreground">
                No schedules added yet.
              </div>
            ) : (
              <div className="space-y-3">
                {schedules.map((schedule, idx) => (
                  <div
                    key={`${schedule.dayOfWeek}-${schedule.startTime}-${idx}`}
                    className="grid gap-3 rounded-lg border border-border/70 bg-secondary/20 p-4 lg:grid-cols-[180px_1fr_1fr_220px_auto]"
                  >
                    <Select
                      value={String(schedule.dayOfWeek)}
                      onChange={(event) =>
                        updateSchedule(idx, 'dayOfWeek', Number(event.target.value))
                      }
                      options={dayNames.map((day, dayIndex) => ({
                        value: String(dayIndex),
                        label: day,
                      }))}
                    />
                    <Input
                      type="time"
                      value={schedule.startTime}
                      onChange={(event) =>
                        updateSchedule(idx, 'startTime', event.target.value)
                      }
                    />
                    <Input
                      type="time"
                      value={schedule.endTime}
                      onChange={(event) =>
                        updateSchedule(idx, 'endTime', event.target.value)
                      }
                    />
                    <Select
                      value={schedule.classroomId}
                      onChange={(event) =>
                        updateSchedule(idx, 'classroomId', event.target.value)
                      }
                      options={classroomOptions}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSchedule(idx)}
                      aria-label={`Remove schedule ${idx + 1}`}
                      title={`Remove schedule ${idx + 1}`}
                    >
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </AdminFormSection>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? 'Saving...'
                : editingSection
                  ? 'Save changes'
                  : 'Create section'}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
