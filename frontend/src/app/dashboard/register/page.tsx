'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ClipboardList,
  Loader2,
  MapPin,
  Users,
} from 'lucide-react';
import { LocalizedLink } from '@/components/LocalizedLink';
import { useRequireAuth } from '@/context/AuthContext';
import {
  coursesApi,
  departmentsApi,
  enrollmentsApi,
  sectionsApi,
  semestersApi,
} from '@/lib/api';
import { pickPreferredSemesterId } from '@/lib/semesters';
import {
  Course,
  Department,
  Enrollment,
  Section,
  Semester,
  WaitlistEntry,
} from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useI18n } from '@/i18n';
import { toast } from 'sonner';

function getDayName(day: number) {
  return [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ][day] ?? '';
}

export default function RegisterPage() {
  const { user, isLoading: authLoading, hasAccess } = useRequireAuth([
    'STUDENT',
  ]);
  const { locale, formatNumber } = useI18n();
  const [sections, setSections] = useState<Section[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedSemester, setSelectedSemester] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isEnrolling, setIsEnrolling] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchBaseData = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const [sectionsRes, enrollmentsRes, semestersRes, departmentsRes] =
        await Promise.all([
          sectionsApi.getAll({ limit: 100 }),
          enrollmentsApi.getMyEnrollments(),
          semestersApi.getAll(),
          departmentsApi.getAll(),
        ]);

      setSections(sectionsRes.data ?? []);
      setEnrollments(enrollmentsRes);
      setSemesters(semestersRes.data ?? []);
      setDepartments(departmentsRes.data ?? []);

      const preferredSemesterId = pickPreferredSemesterId(semestersRes.data);
      if (preferredSemesterId) {
        setSelectedSemester(preferredSemesterId);
      }
    } catch {
      setError(
        locale === 'vi'
          ? 'Hiện chưa thể tải dữ liệu đăng ký học phần.'
          : 'Registration data could not be loaded.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    if (hasAccess) {
      void fetchBaseData();
    }
  }, [fetchBaseData, hasAccess]);

  useEffect(() => {
    if (!selectedDepartment) {
      setCourses([]);
      setSelectedCourse('');
      return;
    }

    let cancelled = false;

    const fetchDepartmentCourses = async () => {
      try {
        const response = await coursesApi.getAll({
          departmentId: selectedDepartment,
          limit: 200,
        });
        if (!cancelled) {
          setCourses(response.data ?? []);
        }
      } catch {
        if (!cancelled) {
          setCourses([]);
          toast.error(
            locale === 'vi'
              ? 'Hiện chưa thể tải môn học của khoa này.'
              : 'Courses for that department could not be loaded.',
          );
        }
      }
    };

    void fetchDepartmentCourses();
    return () => {
      cancelled = true;
    };
  }, [locale, selectedDepartment]);

  const filteredSections = useMemo(() => {
    return sections.filter((section) => {
      if (selectedSemester && section.semesterId !== selectedSemester) {
        return false;
      }
      if (selectedDepartment && section.course?.departmentId !== selectedDepartment) {
        return false;
      }
      if (selectedCourse && section.courseId !== selectedCourse) {
        return false;
      }
      return true;
    });
  }, [sections, selectedCourse, selectedDepartment, selectedSemester]);

  const enrolledSectionIds = useMemo(() => {
    return new Set(enrollments.map((enrollment) => enrollment.sectionId));
  }, [enrollments]);

  const selectedSemesterName = useMemo(() => {
    return (
      semesters.find((semester) => semester.id === selectedSemester)?.name ??
      (locale === 'vi' ? 'tất cả học kỳ' : 'all terms')
    );
  }, [locale, selectedSemester, semesters]);

  const openSections = filteredSections.filter((section) => section.status === 'OPEN');
  const waitlistSections = filteredSections.filter(
    (section) =>
      section.status === 'OPEN' &&
      Math.max(section.capacity - (section.enrolledCount ?? 0), 0) === 0,
  );

  const handleEnroll = async (section: Section) => {
    const copy =
      locale === 'vi'
        ? {
            missingProfile: 'Hồ sơ sinh viên chưa sẵn sàng trong phiên hiện tại.',
            joinedWaitlist: (position: number) =>
              `Đã vào danh sách chờ ở vị trí ${position}.`,
            enrollmentSubmitted: 'Đã gửi đăng ký.',
            enrollmentFailed: 'Hiện chưa thể hoàn tất đăng ký này.',
          }
        : {
            missingProfile: 'Your student profile is not available in this session.',
            joinedWaitlist: (position: number) =>
              `Joined the waitlist at position ${position}.`,
            enrollmentSubmitted: 'Enrollment submitted.',
            enrollmentFailed: 'Enrollment could not be completed.',
          };

    if (!user?.studentId) {
      toast.error(copy.missingProfile);
      return;
    }

    setIsEnrolling(section.id);

    try {
      const result = await enrollmentsApi.enroll(section.id);

      if ('position' in result && result.status === 'ACTIVE') {
        const waitlistResult = result as WaitlistEntry;
        toast.success(copy.joinedWaitlist(waitlistResult.position));
      } else {
        toast.success(copy.enrollmentSubmitted);
      }

      const latestEnrollments = await enrollmentsApi.getMyEnrollments(
        selectedSemester || undefined,
      );
      setEnrollments(latestEnrollments);
    } catch (error: any) {
      toast.error(error.response?.data?.message || copy.enrollmentFailed);
    } finally {
      setIsEnrolling(null);
    }
  };

  const copy =
    locale === 'vi'
      ? {
          eyebrow: 'Workspace sinh viên',
          title: 'Đăng ký học phần',
          description: `Xem các section cho ${selectedSemesterName}, so sánh sức chứa và chuyển vào danh sách chờ mà không rời khỏi student shell.`,
          openCourses: 'Mở môn học của tôi',
          loading: 'Đang tải dữ liệu đăng ký',
          unavailableTitle: 'Đăng ký học phần chưa sẵn sàng',
          availableSections: 'Section khả dụng',
          currentEnrollments: 'Đăng ký hiện tại',
          waitlistCandidates: 'Ứng viên danh sách chờ',
          filterTitle: 'Lọc section',
          semester: 'Học kỳ',
          department: 'Khoa',
          course: 'Môn học',
          allSemesters: 'Tất cả học kỳ',
          allDepartments: 'Tất cả khoa',
          allDepartmentCourses: 'Tất cả môn của khoa',
          selectDepartmentFirst: 'Hãy chọn khoa trước',
          noSectionsTitle: 'Không có section khớp bộ lọc hiện tại',
          noSectionsDescription:
            'Hãy thử một kết hợp học kỳ, khoa hoặc môn học khác để mở rộng danh sách đăng ký.',
          clearFilters: 'Xóa bộ lọc',
          sectionPrefix: 'Section',
          departmentUnavailable: 'Chưa có thông tin khoa',
          departmentSuffix: 'khoa',
          credits: 'tín chỉ',
          seatsLeft: (count: number) => `${count} chỗ trống`,
          sectionFull: 'Section đã đầy',
          alreadyEnrolled: 'Đã đăng ký',
          submitting: 'Đang gửi',
          joinWaitlist: 'Vào danh sách chờ',
          enrollNow: 'Đăng ký ngay',
          reviewCourses: 'Xem môn học hiện tại',
        }
      : {
          eyebrow: 'Student workspace',
          title: 'Course registration',
          description: `Browse sections for ${selectedSemesterName}, compare capacity, and move into waitlists without leaving the protected student shell.`,
          openCourses: 'Open my courses',
          loading: 'Loading registration data',
          unavailableTitle: 'Registration unavailable',
          availableSections: 'Available sections',
          currentEnrollments: 'Current enrollments',
          waitlistCandidates: 'Waitlist candidates',
          filterTitle: 'Filter sections',
          semester: 'Semester',
          department: 'Department',
          course: 'Course',
          allSemesters: 'All semesters',
          allDepartments: 'All departments',
          allDepartmentCourses: 'All department courses',
          selectDepartmentFirst: 'Select a department first',
          noSectionsTitle: 'No sections match the current filters',
          noSectionsDescription:
            'Try another semester, department, or course combination to widen the registration view.',
          clearFilters: 'Clear filters',
          sectionPrefix: 'Section',
          departmentUnavailable: 'Department information unavailable',
          departmentSuffix: 'department',
          credits: 'credits',
          seatsLeft: (count: number) => `${count} seat(s) left`,
          sectionFull: 'Section is full',
          alreadyEnrolled: 'Already enrolled',
          submitting: 'Submitting',
          joinWaitlist: 'Join waitlist',
          enrollNow: 'Enroll now',
          reviewCourses: 'Review current courses',
        };

  if (authLoading || !hasAccess) {
    return <LoadingState label={copy.loading} />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
        title={copy.title}
        description={copy.description}
        actions={
          <LocalizedLink href="/dashboard/enrollments">
            <Button variant="outline">{copy.openCourses}</Button>
          </LocalizedLink>
        }
      />

      {error ? (
        <ErrorState
          title={copy.unavailableTitle}
          description={error}
          onRetry={() => void fetchBaseData()}
        />
      ) : isLoading ? (
        <LoadingState label={copy.loading} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">{copy.availableSections}</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {formatNumber(openSections.length)}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500/12 text-blue-600 dark:text-blue-400">
                  <ClipboardList className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">{copy.currentEnrollments}</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {formatNumber(enrollments.length)}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <BookOpen className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">{copy.waitlistCandidates}</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {formatNumber(waitlistSections.length)}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-500/12 text-amber-600 dark:text-amber-400">
                  <Users className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card variant="muted">
            <CardHeader>
              <CardTitle className="text-xl">{copy.filterTitle}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              <Select
                label={copy.semester}
                value={selectedSemester}
                onChange={(event) => setSelectedSemester(event.target.value)}
                options={[
                  { value: '', label: copy.allSemesters },
                  ...semesters.map((semester) => ({
                    value: semester.id,
                    label: semester.name,
                  })),
                ]}
              />
              <Select
                label={copy.department}
                value={selectedDepartment}
                onChange={(event) => setSelectedDepartment(event.target.value)}
                options={[
                  { value: '', label: copy.allDepartments },
                  ...departments.map((department) => ({
                    value: department.id,
                    label: department.name,
                  })),
                ]}
              />
              <Select
                label={copy.course}
                value={selectedCourse}
                onChange={(event) => setSelectedCourse(event.target.value)}
                disabled={!selectedDepartment}
                options={[
                  {
                    value: '',
                    label: selectedDepartment
                      ? copy.allDepartmentCourses
                      : copy.selectDepartmentFirst,
                  },
                  ...courses.map((course) => ({
                    value: course.id,
                    label: `${course.code} - ${course.name}`,
                  })),
                ]}
              />
            </CardContent>
          </Card>

          {filteredSections.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={copy.noSectionsTitle}
              description={copy.noSectionsDescription}
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedSemester('');
                    setSelectedDepartment('');
                    setSelectedCourse('');
                  }}
                >
                  {copy.clearFilters}
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {filteredSections.map((section) => {
                const seatsLeft = Math.max(
                  section.capacity - (section.enrolledCount ?? 0),
                  0,
                );
                const isEnrolled = enrolledSectionIds.has(section.id);
                const isJoinWaitlist = section.status === 'OPEN' && seatsLeft === 0;

                return (
                  <Card key={section.id} variant="elevated">
                    <CardContent className="pt-6">
                      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-lg font-semibold text-foreground">
                                {section.course?.code} - {section.course?.name}
                              </h2>
                              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                                {copy.sectionPrefix} {section.sectionNumber}
                              </span>
                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                  section.status === 'OPEN'
                                    ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                                    : section.status === 'CLOSED'
                                      ? 'bg-secondary text-foreground'
                                      : 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {section.status}
                              </span>
                            </div>
                            <p className="text-sm leading-6 text-muted-foreground">
                              {section.course?.department?.name
                                ? `${section.course.department.name} ${copy.departmentSuffix}`
                                : copy.departmentUnavailable}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                            <span>
                              {formatNumber(section.course?.credits ?? 0)} {copy.credits}
                            </span>
                            <span>
                              {seatsLeft > 0
                                ? copy.seatsLeft(seatsLeft)
                                : copy.sectionFull}
                            </span>
                            {section.lecturer?.user ? (
                              <span>
                                {section.lecturer.user.firstName}{' '}
                                {section.lecturer.user.lastName}
                              </span>
                            ) : null}
                            {section.classroom ? (
                              <span className="inline-flex items-center gap-2">
                                <MapPin className="h-4 w-4" />
                                {section.classroom.building}{' '}
                                {section.classroom.roomNumber}
                              </span>
                            ) : null}
                          </div>

                          {section.schedules?.length ? (
                            <div className="flex flex-wrap gap-2">
                              {section.schedules.map((schedule, index) => (
                                <span
                                  key={`${section.id}-${index}`}
                                  className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs text-foreground"
                                >
                                  {getDayName(schedule.dayOfWeek)} {schedule.startTime}-
                                  {schedule.endTime}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col gap-3 xl:min-w-[180px]">
                          {isEnrolled ? (
                            <Button type="button" disabled variant="outline">
                              {copy.alreadyEnrolled}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              onClick={() => void handleEnroll(section)}
                              disabled={
                                isEnrolling === section.id ||
                                section.status === 'CLOSED' ||
                                section.status === 'CANCELLED'
                              }
                            >
                              {isEnrolling === section.id ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  {copy.submitting}
                                </>
                              ) : isJoinWaitlist ? (
                                copy.joinWaitlist
                              ) : (
                                copy.enrollNow
                              )}
                            </Button>
                          )}
                          <LocalizedLink href="/dashboard/enrollments">
                            <Button type="button" variant="outline" className="w-full">
                              {copy.reviewCourses}
                            </Button>
                          </LocalizedLink>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
