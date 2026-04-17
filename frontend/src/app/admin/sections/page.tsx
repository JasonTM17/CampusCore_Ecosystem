'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  adminSectionsApi,
  coursesApi,
  adminSemestersApi,
  lecturersApi,
  classroomsApi,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Loader2,
  ClipboardList,
  Search,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  AlertCircle,
  X,
} from 'lucide-react';

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
  department?: { name: string };
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
  const { user, logout, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [sections, setSections] = useState<Section[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [semesterFilter, setSemesterFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
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

  // Redirect non-admins
  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchDropdownData = useCallback(async () => {
    try {
      const [coursesRes, semestersRes, lecturersRes, classroomsRes] =
        await Promise.all([
          coursesApi.getAll({ limit: 1000 }),
          adminSemestersApi.getAll({ limit: 1000 }),
          lecturersApi.getAll({ limit: 1000 }),
          classroomsApi.getAll({ limit: 1000 }),
        ]);
      setCourses(coursesRes.data);
      setSemesters(semestersRes.data);
      setLecturers(lecturersRes.data);
      setClassrooms(classroomsRes.data);
    } catch {
      // Ignore errors for dropdown data
    }
  }, []);

  const fetchSections = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await adminSectionsApi.getAll({
        page,
        limit: 20,
        semesterId: semesterFilter || undefined,
        departmentId: departmentFilter || undefined,
      });
      setSections(response.data);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError('Failed to load sections');
      toast.error('Failed to load sections');
    } finally {
      setIsLoading(false);
    }
  }, [departmentFilter, page, semesterFilter]);

  useEffect(() => {
    if (!canAccess) return;
    void fetchDropdownData();
  }, [canAccess, fetchDropdownData]);

  useEffect(() => {
    if (!canAccess) return;
    void fetchSections();
  }, [canAccess, fetchSections]);

  if (!canAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this section?')) return;

    try {
      await adminSectionsApi.delete(id);
      toast.success('Section deleted successfully');
      fetchSections();
    } catch {
      toast.error('Failed to delete section');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        capacity: parseInt(String(formData.capacity)),
        schedules: schedules.length > 0 ? schedules : undefined,
      };

      if (editingSection) {
        await adminSectionsApi.update(editingSection.id, payload);
        toast.success('Section updated successfully');
      } else {
        await adminSectionsApi.create(payload);
        toast.success('Section created successfully');
      }
      setShowModal(false);
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
      fetchSections();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Operation failed');
    }
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

    // Load schedules
    const fullSection = await adminSectionsApi.getById(section.id);
    setSchedules(
      (fullSection.schedules || []).map((schedule) => ({
        dayOfWeek: schedule.dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        classroomId: schedule.classroom?.id || '',
      })),
    );

    setShowModal(true);
  };

  const addSchedule = () => {
    setSchedules([
      ...schedules,
      { dayOfWeek: 1, startTime: '09:00', endTime: '10:30', classroomId: '' },
    ]);
  };

  const removeSchedule = (index: number) => {
    setSchedules(schedules.filter((_, i) => i !== index));
  };

  const updateSchedule = (
    index: number,
    field: keyof ScheduleEntry,
    value: any,
  ) => {
    setSchedules(
      schedules.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-slate-800 text-white shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="flex items-center gap-2 text-gray-300 hover:text-white"
              aria-label="Back to admin dashboard"
              title="Back to admin dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-xl font-bold">CampusCore Admin</h1>
            <span className="text-gray-500">|</span>
            <span className="text-gray-300">Section Management</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-300">Welcome, {user?.firstName}</span>
            <Button
              variant="outline"
              className="text-white border-gray-600 hover:bg-gray-700"
              onClick={logout}
            >
              Logout
            </Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="h-7 w-7 text-primary" />
              Section Management
            </h2>
            <p className="text-gray-500 mt-1">
              Manage class sections and schedules
            </p>
          </div>
          <Button
            onClick={() => {
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
              setShowModal(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> Create Section
          </Button>
        </div>

        {/* Filters */}
        <div className="mb-6 flex gap-4 flex-wrap">
          <select
            value={semesterFilter}
            onChange={(e) => {
              setSemesterFilter(e.target.value);
              setPage(1);
            }}
            className="px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Semesters</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
            <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
            <p className="text-red-600 font-medium mb-2">{error}</p>
            <Button variant="outline" onClick={fetchSections}>
              Try Again
            </Button>
          </div>
        )}

        {/* Sections Table */}
        {!error && (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">
                      Course
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">
                      Section
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">
                      Semester
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">
                      Lecturer
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">
                      Capacity
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">
                      Schedule
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">
                      Status
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sections.map((section) => (
                    <tr
                      key={section.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-900">
                            {section.course?.code}
                          </p>
                          <p className="text-gray-500 text-xs">
                            {section.course?.name}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {section.sectionNumber}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {section.semester?.name || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {section.lecturer?.user
                          ? `${section.lecturer.user.firstName} ${section.lecturer.user.lastName}`
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">
                        {section.capacity}
                      </td>
                      <td className="px-4 py-3">
                        {section.schedules && section.schedules.length > 0 ? (
                          <div className="space-y-1">
                            {section.schedules.map((sched, idx) => (
                              <div key={idx} className="text-xs">
                                <span className="font-medium">
                                  {dayNames[sched.dayOfWeek]}
                                </span>{' '}
                                {sched.startTime}-{sched.endTime}
                                <span className="text-gray-400">
                                  {' '}
                                  {sched.classroom?.building}
                                  {sched.classroom?.roomNumber}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-xs">
                            No schedule
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            section.status === 'OPEN'
                              ? 'bg-green-100 text-green-700'
                              : section.status === 'CLOSED'
                                ? 'bg-gray-100 text-gray-600'
                                : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {section.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(section)}
                            aria-label={`Edit section ${section.sectionNumber} for ${section.course?.code || 'course'}`}
                            title={`Edit section ${section.sectionNumber} for ${section.course?.code || 'course'}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => handleDelete(section.id)}
                            aria-label={`Delete section ${section.sectionNumber} for ${section.course?.code || 'course'}`}
                            title={`Delete section ${section.sectionNumber} for ${section.course?.code || 'course'}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Empty state */}
            {sections.length === 0 && !isLoading && (
              <div className="p-8 text-center">
                <ClipboardList className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No sections found</p>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="border-t px-4 py-3 flex justify-between items-center">
                <span className="text-sm text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-6 my-8 mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {editingSection ? 'Edit Section' : 'Create Section'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Course *
                  </label>
                  <select
                    value={formData.courseId}
                    onChange={(e) =>
                      setFormData({ ...formData, courseId: e.target.value })
                    }
                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">Select Course</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} - {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Semester *
                  </label>
                  <select
                    value={formData.semesterId}
                    onChange={(e) =>
                      setFormData({ ...formData, semesterId: e.target.value })
                    }
                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">Select Semester</option>
                    {semesters.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Section Number *
                  </label>
                  <input
                    type="text"
                    value={formData.sectionNumber}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        sectionNumber: e.target.value,
                      })
                    }
                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Capacity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.capacity}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        capacity: parseInt(e.target.value) || 30,
                      })
                    }
                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => {
                      const nextStatus = e.target.value;
                      if (isSectionStatus(nextStatus)) {
                        setFormData({ ...formData, status: nextStatus });
                      }
                    }}
                    className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="OPEN">Open</option>
                    <option value="CLOSED">Closed</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Lecturer
                </label>
                <select
                  value={formData.lecturerId}
                  onChange={(e) =>
                    setFormData({ ...formData, lecturerId: e.target.value })
                  }
                  className="mt-1 block w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">No Lecturer Assigned</option>
                  {lecturers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.user?.firstName} {l.user?.lastName} ({l.employeeId})
                    </option>
                  ))}
                </select>
              </div>

              {/* Schedules */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Schedules
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addSchedule}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add Schedule
                  </Button>
                </div>

                {schedules.length === 0 ? (
                  <p className="text-gray-400 text-sm italic">
                    No schedules added. Click Add Schedule to add class times.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {schedules.map((schedule, idx) => (
                      <div
                        key={idx}
                        className="flex gap-2 items-start p-3 bg-gray-50 rounded-md"
                      >
                        <select
                          value={schedule.dayOfWeek}
                          onChange={(e) =>
                            updateSchedule(
                              idx,
                              'dayOfWeek',
                              parseInt(e.target.value),
                            )
                          }
                          className="px-2 py-1 border rounded text-sm"
                        >
                          {dayNames.map((day, dIdx) => (
                            <option key={dIdx} value={dIdx}>
                              {day}
                            </option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={schedule.startTime}
                          onChange={(e) =>
                            updateSchedule(idx, 'startTime', e.target.value)
                          }
                          className="px-2 py-1 border rounded text-sm"
                        />
                        <span className="text-gray-500">to</span>
                        <input
                          type="time"
                          value={schedule.endTime}
                          onChange={(e) =>
                            updateSchedule(idx, 'endTime', e.target.value)
                          }
                          className="px-2 py-1 border rounded text-sm"
                        />
                        <select
                          value={schedule.classroomId}
                          onChange={(e) =>
                            updateSchedule(idx, 'classroomId', e.target.value)
                          }
                          className="px-2 py-1 border rounded text-sm flex-1"
                        >
                          <option value="">Select Room</option>
                          {classrooms.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.building} {c.roomNumber}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeSchedule(idx)}
                          aria-label={`Remove schedule ${idx + 1}`}
                          title={`Remove schedule ${idx + 1}`}
                        >
                          <X className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowModal(false);
                    setEditingSection(null);
                    setSchedules([]);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  {editingSection ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
