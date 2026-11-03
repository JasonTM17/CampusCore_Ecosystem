/**
 * Admin academic-resource surfaces: enrollments, semesters, courses,
 * departments, lecturers, classrooms, and academic years.
 *
 * These seven pages rendered the same copy skeleton inline (`locale === 'vi' ?`
 * blocks), so every page group below carries that one skeleton and only adds the
 * fields its own form/table needs:
 *
 *   loading / title / description / create / searchLabel / searchPlaceholder /
 *   pageSummaryEmpty / pageSummary / unavailableTitle / emptyTitle /
 *   emptyDescription / tableTitle / loadFailed
 *   + the shared record-action cluster (active/inactive, delete/update/create
 *     toasts, dialog titles, saving label, row aria-label templates)
 *   + `headers.*` for the table columns
 *
 * String values keep template tokens (`{year}`, `{learnerLabel}`, `{pages}`)
 * because Vietnamese and English order the interpolations differently; pages
 * fill them with `.replace('{token}', () => value)`.
 *
 * The fragment is consumed through a direct import (`adminAcademicsEn` /
 * `adminAcademicsVi` selected by the locale hook) so the pages work before the
 * integrator mounts it on the root catalogue as `adminAcademics`.
 */

type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : T extends object
      ? { readonly [K in keyof T]: Widen<T[K]> }
      : T;

/** The keys every admin-academics page renders, in render order. */
interface AdminAcademicsPageSkeleton {
  loading: string;
  title: string;
  description: string;
  create: string;
  searchLabel: string;
  searchPlaceholder: string;
  pageSummaryEmpty: string;
  pageSummary: string;
  unavailableTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  tableTitle: string;
  loadFailed: string;
}

/** Status badge, record mutations, and row action labels shared by the list pages. */
interface AdminAcademicsRecordActions {
  active: string;
  inactive: string;
  deleteTitle: string;
  deleteMessage: string;
  deleteConfirm: string;
  deleted: string;
  deleteFailed: string;
  updated: string;
  created: string;
  saveFailed: string;
  editTitle: string;
  createTitle: string;
  saving: string;
  editLabel: string;
  deleteLabel: string;
}

interface EnrollmentsPageCopy {
  loading: string;
  title: string;
  description: string;
  exportCsv: string;
  searchLabel: string;
  searchPlaceholder: string;
  semester: string;
  course: string;
  section: string;
  status: string;
  allSemesters: string;
  allCourses: string;
  allSections: string;
  allStatuses: string;
  statusOptions: {
    ENROLLED: string;
    PENDING: string;
    CONFIRMED: string;
    COMPLETED: string;
    DROPPED: string;
    CANCELLED: string;
  };
  enrollmentsCount: string;
  enrollmentsCountOne: string;
  unavailableTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  tableTitle: string;
  pageSummary: string;
  loadFailed: string;
  sectionsLoadFailed: string;
  headers: {
    student: string;
    course: string;
    section: string;
    semester: string;
    lecturer: string;
    status: string;
    enrolledDate: string;
    actions: string;
  };
  noEmail: string;
  unknownCourse: string;
  noCourseName: string;
  unknownSection: string;
  unassigned: string;
  viewDetail: string;
  closeDetail: string;
  deleteTitle: string;
  deleteMessage: string;
  deleteConfirm: string;
  deleted: string;
  deleteFailed: string;
  exportStarted: string;
  exportFailed: string;
  detailFailed: string;
  viewLabel: string;
  viewStudentLabel: string;
  deleteLabel: string;
  detail: {
    title: string;
    studentProfile: string;
    studentCode: string;
    studentId: string;
    enrollmentId: string;
    student: string;
    status: string;
    course: string;
    section: string;
    semester: string;
    lecturer: string;
    enrolledAt: string;
    droppedAt: string;
    finalGrade: string;
    letterGrade: string;
    close: string;
  };
}

interface SemestersPageCopy
  extends AdminAcademicsPageSkeleton,
    AdminAcademicsRecordActions {
  headers: {
    name: string;
    type: string;
    academicYear: string;
    startDate: string;
    endDate: string;
    status: string;
    actions: string;
  };
  selectAcademicYear: string;
  referenceLoadFailed: string;
  unassigned: string;
  fields: {
    name: string;
    namePlaceholder: string;
    englishName: string;
    englishNamePlaceholder: string;
    vietnameseName: string;
    type: string;
    academicYear: string;
    startDate: string;
    endDate: string;
  };
  typeOptions: {
    FIRST: string;
    SECOND: string;
    SUMMER: string;
    FALL: string;
    SPRING: string;
  };
  statusLabels: {
    ACTIVE: string;
    IN_PROGRESS: string;
    REGISTRATION_OPEN: string;
    ADD_DROP_OPEN: string;
    DRAFT: string;
  };
}

interface CoursesPageCopy
  extends AdminAcademicsPageSkeleton,
    AdminAcademicsRecordActions {
  headers: {
    code: string;
    name: string;
    credits: string;
    department: string;
    status: string;
    actions: string;
  };
  department: string;
  allDepartments: string;
  selectDepartment: string;
  referenceLoadFailed: string;
  staleEdit: string;
  unassigned: string;
  courseCode: string;
  creditsLabel: string;
  courseName: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  fields: {
    englishName: string;
    vietnameseName: string;
    englishDescription: string;
    vietnameseDescription: string;
  };
}

interface DepartmentsPageCopy
  extends AdminAcademicsPageSkeleton,
    AdminAcademicsRecordActions {
  headers: {
    code: string;
    name: string;
    description: string;
    status: string;
    actions: string;
  };
  noDescription: string;
  fields: {
    code: string;
    name: string;
    description: string;
    englishName: string;
    vietnameseName: string;
    englishDescription: string;
    vietnameseDescription: string;
  };
  banner: {
    eyebrow: string;
    title: string;
    description: string;
    unitsLabel: string;
    activeOnPage: string;
    curriculumLabel: string;
    imageAlt: string;
    labLabel: string;
  };
}

interface LecturersPageCopy
  extends AdminAcademicsPageSkeleton,
    AdminAcademicsRecordActions {
  headers: {
    employeeId: string;
    lecturer: string;
    email: string;
    department: string;
    specialization: string;
    status: string;
    actions: string;
  };
  selectDepartment: string;
  referenceLoadFailed: string;
  unlinkedAccount: string;
  noEmail: string;
  unassigned: string;
  notProvided: string;
  fields: {
    employeeId: string;
    userId: string;
    userIdPlaceholder: string;
    department: string;
    specialization: string;
    specializationPlaceholder: string;
  };
}

interface ClassroomsPageCopy
  extends AdminAcademicsPageSkeleton,
    AdminAcademicsRecordActions {
  headers: {
    building: string;
    room: string;
    capacity: string;
    type: string;
    status: string;
    actions: string;
  };
  fields: {
    building: string;
    roomNumber: string;
    capacity: string;
    type: string;
  };
  typeOptions: {
    LECTURE: string;
    LAB: string;
    WORKSHOP: string;
    SEMINAR: string;
    AUDITORIUM: string;
    OTHER: string;
  };
}

interface AcademicYearsPageCopy
  extends AdminAcademicsPageSkeleton,
    AdminAcademicsRecordActions {
  headers: {
    year: string;
    startDate: string;
    endDate: string;
    status: string;
    actions: string;
  };
  endDateBeforeStart: string;
  yearLabel: string;
  startDateLabel: string;
  endDateLabel: string;
}

export const adminAcademicsEn: {
  enrollments: EnrollmentsPageCopy;
  semesters: SemestersPageCopy;
  courses: CoursesPageCopy;
  departments: DepartmentsPageCopy;
  lecturers: LecturersPageCopy;
  classrooms: ClassroomsPageCopy;
  academicYears: AcademicYearsPageCopy;
} = {
  enrollments: {
    loading: 'Loading enrollments',
    title: 'Enrollments',
    description:
      'Review registrations by student, section, and status; open the student profile context from the list.',
    exportCsv: 'Export CSV',
    searchLabel: 'Search student / course',
    searchPlaceholder: 'Search by student name, ID, email, or course',
    semester: 'Semester',
    course: 'Course',
    section: 'Section',
    status: 'Status',
    allSemesters: 'All semesters',
    allCourses: 'All courses',
    allSections: 'All sections',
    allStatuses: 'All statuses',
    statusOptions: {
      ENROLLED: 'Registered',
      PENDING: 'Pending',
      CONFIRMED: 'Confirmed',
      COMPLETED: 'Completed',
      DROPPED: 'Dropped',
      CANCELLED: 'Cancelled',
    },
    enrollmentsCount: '{count} enrollments',
    enrollmentsCountOne: '{count} enrollment',
    unavailableTitle: 'Enrollments unavailable',
    emptyTitle: 'No matching enrollments',
    emptyDescription:
      'When students start registering, this view will show course, section, semester, and final status in one place.',
    tableTitle: 'Enrollment records',
    pageSummary: 'Page {currentPage} of {pages}',
    loadFailed: 'Enrollments could not be loaded.',
    sectionsLoadFailed: 'Sections for the selected course could not be loaded.',
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
    viewDetail: 'Student enrollment profile',
    closeDetail: 'Close enrollment details',
    deleteTitle: 'Delete enrollment',
    deleteMessage: "Delete {learnerLabel}'s enrollment? This action cannot be undone.",
    deleteConfirm: 'Delete enrollment',
    deleted: 'Enrollment deleted',
    deleteFailed: 'We could not delete that enrollment.',
    exportStarted: 'Enrollment export started',
    exportFailed: 'Enrollments could not be exported.',
    detailFailed: 'Enrollment details could not be loaded.',
    viewLabel: 'View enrollment details for {learnerLabel}',
    viewStudentLabel: 'Open student enrollment profile for {learnerLabel}',
    deleteLabel: 'Delete enrollment for {learnerLabel}',
    detail: {
      title: 'Student enrollment profile',
      studentProfile: 'Student profile',
      studentCode: 'Student code',
      studentId: 'Student ID',
      enrollmentId: 'Enrollment ID',
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
  },
  semesters: {
    loading: 'Loading semesters',
    title: 'Semesters',
    description:
      'Keep registration windows and teaching periods anchored to a clear academic calendar.',
    create: 'Create semester',
    searchLabel: 'Search semesters',
    searchPlaceholder: 'Search by semester, type, or year',
    pageSummaryEmpty: 'No matching records',
    pageSummary: 'Page {currentPage} of {pages}',
    unavailableTitle: 'Semesters unavailable',
    emptyTitle: 'No matching semesters',
    emptyDescription:
      'Create a semester to align classes, registration dates, schedules, and grades.',
    tableTitle: 'Semester records',
    loadFailed: 'Semesters could not be loaded.',
    headers: {
      name: 'Name',
      type: 'Type',
      academicYear: 'Academic year',
      startDate: 'Start date',
      endDate: 'End date',
      status: 'Status',
      actions: 'Actions',
    },
    selectAcademicYear: 'Select academic year',
    referenceLoadFailed: 'Academic-year options could not be loaded.',
    unassigned: 'Unassigned',
    active: 'Active',
    inactive: 'Inactive',
    deleteTitle: 'Delete semester',
    deleteMessage: 'Delete {name}? This removes the semester from the current admin view.',
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
      namePlaceholder: 'e.g. Fall Semester 2026',
      englishName: 'English name',
      englishNamePlaceholder: 'e.g. Fall 2026',
      vietnameseName: 'Vietnamese name',
      type: 'Type',
      academicYear: 'Academic year',
      startDate: 'Start date',
      endDate: 'End date',
    },
    typeOptions: {
      FIRST: 'Semester 1',
      SECOND: 'Semester 2',
      SUMMER: 'Summer',
      FALL: 'Fall',
      SPRING: 'Spring',
    },
    statusLabels: {
      ACTIVE: 'Active',
      IN_PROGRESS: 'In progress',
      REGISTRATION_OPEN: 'Registration open',
      ADD_DROP_OPEN: 'Add or drop open',
      DRAFT: 'Draft',
    },
    saving: 'Saving...',
    editLabel: 'Edit semester {name}',
    deleteLabel: 'Delete semester {name}',
  },
  courses: {
    loading: 'Loading courses',
    title: 'Courses',
    description:
      'Maintain the course catalogue with clear responsibilities, credit values, and a consistent academic structure.',
    create: 'Create course',
    searchLabel: 'Search courses',
    searchPlaceholder: 'Search by code or name',
    pageSummaryEmpty: 'No matching records',
    pageSummary: 'Page {currentPage} of {pages}',
    unavailableTitle: 'Courses unavailable',
    emptyTitle: 'No matching courses',
    emptyDescription:
      'Create a course so classes and registration share the same course information.',
    tableTitle: 'Course records',
    loadFailed: 'Courses could not be loaded.',
    headers: {
      code: 'Code',
      name: 'Name',
      credits: 'Credits',
      department: 'Department',
      status: 'Status',
      actions: 'Actions',
    },
    department: 'Department',
    allDepartments: 'All departments',
    selectDepartment: 'Select department',
    referenceLoadFailed: 'Department options could not be loaded.',
    unassigned: 'Unassigned',
    active: 'Active',
    inactive: 'Inactive',
    deleteTitle: 'Delete course',
    deleteMessage: 'Delete {code}? This removes the course from the current admin view.',
    deleteConfirm: 'Delete course',
    deleted: 'Course deleted',
    deleteFailed: 'We could not delete that course.',
    updated: 'Course updated',
    created: 'Course created',
    saveFailed: 'The course could not be saved.',
    staleEdit: 'This course changed after you opened it. Your edits are still here; reload to compare before saving.',
    editTitle: 'Edit course',
    createTitle: 'Create course',
    courseCode: 'Course code',
    creditsLabel: 'Credits',
    courseName: 'Course name',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Optional course notes',
    fields: {
      englishName: 'English name',
      vietnameseName: 'Vietnamese name',
      englishDescription: 'English description',
      vietnameseDescription: 'Vietnamese description',
    },
    saving: 'Saving...',
    editLabel: 'Edit course {code}',
    deleteLabel: 'Delete course {code}',
  },
  departments: {
    loading: 'Loading departments',
    title: 'Departments',
    description:
      'Keep the academic structure readable for courses, lecturers, and curriculum responsibilities.',
    create: 'Create department',
    searchLabel: 'Search departments',
    searchPlaceholder: 'Search by name or code',
    pageSummaryEmpty: 'No matching records',
    pageSummary: 'Page {currentPage} of {pages}',
    unavailableTitle: 'Departments unavailable',
    emptyTitle: 'No matching departments',
    emptyDescription:
      'Create a department to organize courses, lecturer assignments, and curriculum responsibilities.',
    tableTitle: 'Department records',
    loadFailed: 'Departments could not be loaded.',
    headers: {
      code: 'Code',
      name: 'Name',
      description: 'Description',
      status: 'Status',
      actions: 'Actions',
    },
    noDescription: 'No description',
    active: 'Active',
    inactive: 'Inactive',
    deleteTitle: 'Delete department',
    deleteMessage: 'Delete {name}? This removes the department from the current admin view.',
    deleteConfirm: 'Delete department',
    deleted: 'Department deleted',
    deleteFailed: 'We could not delete that department.',
    updated: 'Department updated',
    created: 'Department created',
    saveFailed: 'The department could not be saved.',
    editTitle: 'Edit department',
    createTitle: 'Create department',
    fields: {
      code: 'Code',
      name: 'Name',
      description: 'Description',
      englishName: 'English name',
      vietnameseName: 'Vietnamese name',
      englishDescription: 'English description',
      vietnameseDescription: 'Vietnamese description',
    },
    banner: {
      eyebrow: 'HCMUTE ACADEMIC FACULTIES & DEPARTMENTS',
      title: 'Faculty & Department Administration',
      description:
        'Manage university faculties, specialized research laboratories, and academic departments supporting curriculum delivery and thesis mentorship.',
      unitsLabel: 'Academic Units',
      activeOnPage: 'Active on this page',
      curriculumLabel: 'Curriculum Aligned',
      imageAlt: 'HCMUTE IT Department Research Lab',
      labLabel: 'Smart Systems & Robotics Lab',
    },
    saving: 'Saving...',
    editLabel: 'Edit department {name}',
    deleteLabel: 'Delete department {name}',
  },
  lecturers: {
    loading: 'Loading lecturers',
    title: 'Lecturers',
    description:
      'Keep teaching assignments tied to the right people, departments, and profile details.',
    create: 'Create lecturer',
    searchLabel: 'Search lecturers',
    searchPlaceholder: 'Search by name, email, or employee ID',
    pageSummaryEmpty: 'No matching records',
    pageSummary: 'Page {currentPage} of {pages}',
    unavailableTitle: 'Lecturers unavailable',
    emptyTitle: 'No matching lecturers',
    emptyDescription:
      'Create a lecturer profile to keep schedules, classes, and grading responsibilities aligned.',
    tableTitle: 'Lecturer records',
    loadFailed: 'Lecturers could not be loaded.',
    headers: {
      employeeId: 'Employee ID',
      lecturer: 'Lecturer',
      email: 'Email',
      department: 'Department',
      specialization: 'Specialization',
      status: 'Status',
      actions: 'Actions',
    },
    selectDepartment: 'Select department',
    referenceLoadFailed: 'Department options could not be loaded.',
    unlinkedAccount: 'Unlinked account',
    noEmail: 'No email',
    unassigned: 'Unassigned',
    notProvided: 'Not provided',
    active: 'Active',
    inactive: 'Inactive',
    deleteTitle: 'Delete lecturer',
    deleteMessage: 'Delete {employeeId}? This removes the lecturer from the current admin view.',
    deleteConfirm: 'Delete lecturer',
    deleted: 'Lecturer deleted',
    deleteFailed: 'We could not delete that lecturer.',
    updated: 'Lecturer updated',
    created: 'Lecturer created',
    saveFailed: 'The lecturer profile could not be saved.',
    editTitle: 'Edit lecturer',
    createTitle: 'Create lecturer',
    fields: {
      employeeId: 'Employee ID',
      userId: 'Linked user ID',
      userIdPlaceholder: 'Existing user account ID',
      department: 'Department',
      specialization: 'Specialization',
      specializationPlaceholder: 'Optional subject or field focus',
    },
    saving: 'Saving...',
    editLabel: 'Edit lecturer {employeeId}',
    deleteLabel: 'Delete lecturer {employeeId}',
  },
  classrooms: {
    loading: 'Loading classrooms',
    title: 'Classrooms',
    description:
      'Keep room inventory readable so sections, schedules, and capacity planning stay aligned.',
    create: 'Create classroom',
    searchLabel: 'Search classrooms',
    searchPlaceholder: 'Search by building or room number',
    pageSummaryEmpty: 'No matching records',
    pageSummary: 'Page {currentPage} of {pages}',
    unavailableTitle: 'Classrooms unavailable',
    emptyTitle: 'No matching classrooms',
    emptyDescription:
      'Create a classroom so section scheduling has a reliable room inventory to work with.',
    tableTitle: 'Classroom records',
    loadFailed: 'Classrooms could not be loaded.',
    headers: {
      building: 'Building',
      room: 'Room',
      capacity: 'Capacity',
      type: 'Type',
      status: 'Status',
      actions: 'Actions',
    },
    fields: {
      building: 'Building',
      roomNumber: 'Room number',
      capacity: 'Capacity',
      type: 'Type',
    },
    typeOptions: {
      LECTURE: 'Lecture',
      LAB: 'Lab',
      WORKSHOP: 'Workshop',
      SEMINAR: 'Seminar',
      AUDITORIUM: 'Auditorium',
      OTHER: 'Other',
    },
    active: 'Active',
    inactive: 'Inactive',
    deleteTitle: 'Delete classroom',
    deleteMessage:
      'Delete {building} {roomNumber}? This removes the classroom from the current admin view.',
    deleteConfirm: 'Delete classroom',
    deleted: 'Classroom deleted',
    deleteFailed: 'We could not delete that classroom.',
    updated: 'Classroom updated',
    created: 'Classroom created',
    saveFailed: 'The classroom could not be saved.',
    editTitle: 'Edit classroom',
    createTitle: 'Create classroom',
    saving: 'Saving...',
    editLabel: 'Edit classroom {building} {roomNumber}',
    deleteLabel: 'Delete classroom {building} {roomNumber}',
  },
  academicYears: {
    loading: 'Loading academic years',
    title: 'Academic years',
    description:
      'Keep the academic calendar clean, searchable, and deliberate before semesters and registration windows build on top of it.',
    create: 'Create academic year',
    searchLabel: 'Search academic years',
    searchPlaceholder: 'Search by year',
    pageSummaryEmpty: 'No matching records',
    pageSummary: 'Page {currentPage} of {pages}',
    unavailableTitle: 'Academic years unavailable',
    emptyTitle: 'No matching academic years',
    emptyDescription:
      'Create a new academic year to give semester planning a clean anchor.',
    tableTitle: 'Academic year records',
    loadFailed: 'Academic years could not be loaded.',
    headers: {
      year: 'Year',
      startDate: 'Start date',
      endDate: 'End date',
      status: 'Status',
      actions: 'Actions',
    },
    active: 'Active',
    inactive: 'Inactive',
    deleteTitle: 'Delete academic year',
    deleteMessage: 'Delete {year}? This removes the academic year from the current admin view.',
    deleteConfirm: 'Delete academic year',
    deleted: 'Academic year deleted',
    deleteFailed: 'We could not delete that academic year.',
    updated: 'Academic year updated',
    created: 'Academic year created',
    saveFailed: 'The academic year could not be saved.',
    endDateBeforeStart: 'End date must be after the start date.',
    editTitle: 'Edit academic year',
    createTitle: 'Create academic year',
    yearLabel: 'Year',
    startDateLabel: 'Start date',
    endDateLabel: 'End date',
    saving: 'Saving...',
    editLabel: 'Edit academic year {year}',
    deleteLabel: 'Delete academic year {year}',
  },
};

export const adminAcademicsVi: Widen<typeof adminAcademicsEn> = {
  enrollments: {
    loading: 'Đang tải danh sách đăng ký học phần',
    title: 'Quản lý Đăng ký học phần',
    description:
      'Rà soát và quản lý hồ sơ đăng ký học phần theo sinh viên, lớp học phần và trạng thái đào tạo.',
    exportCsv: 'Xuất CSV',
    searchLabel: 'Tìm sinh viên / học phần',
    searchPlaceholder: 'Tìm theo họ tên, MSSV, email hoặc môn học',
    semester: 'Học kỳ',
    course: 'Môn học',
    section: 'Lớp học phần',
    status: 'Trạng thái',
    allSemesters: 'Tất cả học kỳ',
    allCourses: 'Tất cả môn học',
    allSections: 'Tất cả lớp học phần',
    allStatuses: 'Tất cả trạng thái',
    statusOptions: {
      ENROLLED: 'Đã đăng ký',
      PENDING: 'Chờ xác nhận',
      CONFIRMED: 'Đã xác nhận',
      COMPLETED: 'Hoàn tất',
      DROPPED: 'Đã rút',
      CANCELLED: 'Đã hủy',
    },
    enrollmentsCount: '{count} đăng ký',
    enrollmentsCountOne: '{count} đăng ký',
    unavailableTitle: 'Đăng ký chưa sẵn sàng',
    emptyTitle: 'Không có đăng ký phù hợp',
    emptyDescription:
      'Khi sinh viên bắt đầu đăng ký, màn hình này sẽ hiển thị môn học, lớp học phần, học kỳ và trạng thái cuối cùng trong cùng một nơi.',
    tableTitle: 'Bản ghi đăng ký',
    pageSummary: 'Trang {currentPage} / {pages}',
    loadFailed: 'Hiện chưa thể tải danh sách đăng ký.',
    sectionsLoadFailed: 'Hiện chưa thể tải danh sách lớp học phần cho môn học đã chọn.',
    headers: {
      student: 'Sinh viên',
      course: 'Môn học',
      section: 'Lớp học phần',
      semester: 'Học kỳ',
      lecturer: 'Giảng viên',
      status: 'Trạng thái',
      enrolledDate: 'Ngày đăng ký',
      actions: 'Tác vụ',
    },
    noEmail: 'Chưa có email',
    unknownCourse: 'Chưa rõ môn học',
    noCourseName: 'Chưa có tên môn',
    unknownSection: 'Chưa rõ lớp học phần',
    unassigned: 'Chưa gán',
    viewDetail: 'Hồ sơ đăng ký sinh viên',
    closeDetail: 'Đóng chi tiết đăng ký',
    deleteTitle: 'Xóa đăng ký',
    deleteMessage: 'Xóa đăng ký của {learnerLabel}? Hành động này không thể hoàn tác.',
    deleteConfirm: 'Xóa đăng ký',
    deleted: 'Đã xóa đăng ký',
    deleteFailed: 'Hiện chưa thể xóa đăng ký này.',
    exportStarted: 'Đã bắt đầu xuất dữ liệu đăng ký',
    exportFailed: 'Hiện chưa thể xuất dữ liệu đăng ký.',
    detailFailed: 'Hiện chưa thể tải chi tiết đăng ký.',
    viewLabel: 'Xem chi tiết đăng ký của {learnerLabel}',
    viewStudentLabel: 'Mở hồ sơ đăng ký của sinh viên {learnerLabel}',
    deleteLabel: 'Xóa đăng ký của {learnerLabel}',
    detail: {
      title: 'Hồ sơ đăng ký sinh viên',
      studentProfile: 'Hồ sơ sinh viên',
      studentCode: 'Mã sinh viên',
      studentId: 'Mã định danh sinh viên',
      enrollmentId: 'Mã hồ sơ đăng ký',
      student: 'Sinh viên',
      status: 'Trạng thái',
      course: 'Môn học',
      section: 'Lớp học phần',
      semester: 'Học kỳ',
      lecturer: 'Giảng viên',
      enrolledAt: 'Đăng ký lúc',
      droppedAt: 'Rút lúc',
      finalGrade: 'Điểm cuối kỳ',
      letterGrade: 'Điểm chữ',
      close: 'Đóng',
    },
  },
  semesters: {
    loading: 'Đang tải học kỳ',
    title: 'Học kỳ',
    description:
      'Giữ mốc thời gian học kỳ rõ ràng để đăng ký, lớp học phần và lịch học luôn đồng bộ.',
    create: 'Tạo học kỳ',
    searchLabel: 'Tìm học kỳ',
    searchPlaceholder: 'Tìm theo học kỳ, loại hoặc năm',
    pageSummaryEmpty: 'Không có bản ghi phù hợp',
    pageSummary: 'Trang {currentPage} / {pages}',
    unavailableTitle: 'Học kỳ chưa sẵn sàng',
    emptyTitle: 'Không có học kỳ phù hợp',
    emptyDescription:
      'Hãy tạo học kỳ để lớp học phần, đăng ký, lịch học và điểm dùng chung một mốc thời gian.',
    tableTitle: 'Bản ghi học kỳ',
    loadFailed: 'Hiện chưa thể tải danh sách học kỳ.',
    headers: {
      name: 'Tên học kỳ',
      type: 'Loại',
      academicYear: 'Năm học',
      startDate: 'Ngày bắt đầu',
      endDate: 'Ngày kết thúc',
      status: 'Trạng thái',
      actions: 'Tác vụ',
    },
    selectAcademicYear: 'Chọn năm học',
    referenceLoadFailed: 'Hiện chưa thể tải dữ liệu năm học cho biểu mẫu.',
    unassigned: 'Chưa gán',
    active: 'Đang hoạt động',
    inactive: 'Ngừng hoạt động',
    deleteTitle: 'Xóa học kỳ',
    deleteMessage: 'Xóa {name}? Hành động này sẽ gỡ học kỳ khỏi màn hình quản trị hiện tại.',
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
      namePlaceholder: 'Ví dụ: Học kỳ Thu 2026',
      englishName: 'Tên tiếng Anh',
      englishNamePlaceholder: 'Ví dụ: Fall 2026',
      vietnameseName: 'Tên tiếng Việt',
      type: 'Loại',
      academicYear: 'Năm học',
      startDate: 'Ngày bắt đầu',
      endDate: 'Ngày kết thúc',
    },
    typeOptions: {
      FIRST: 'Học kỳ 1',
      SECOND: 'Học kỳ 2',
      SUMMER: 'Học kỳ Hè',
      FALL: 'Học kỳ Thu',
      SPRING: 'Học kỳ Xuân',
    },
    statusLabels: {
      ACTIVE: 'Đang diễn ra',
      IN_PROGRESS: 'Đang diễn ra',
      REGISTRATION_OPEN: 'Đang mở đăng ký',
      ADD_DROP_OPEN: 'Đang mở thêm hoặc hủy môn',
      DRAFT: 'Bản nháp',
    },
    saving: 'Đang lưu...',
    editLabel: 'Chỉnh sửa học kỳ {name}',
    deleteLabel: 'Xóa học kỳ {name}',
  },
  courses: {
    loading: 'Đang tải môn học',
    title: 'Môn học',
    description:
      'Quản lý danh sách môn học với người phụ trách rõ ràng, số tín chỉ nhất quán và cấu trúc ổn định.',
    create: 'Tạo môn học',
    searchLabel: 'Tìm môn học',
    searchPlaceholder: 'Tìm theo mã hoặc tên môn',
    pageSummaryEmpty: 'Không có bản ghi phù hợp',
    pageSummary: 'Trang {currentPage} / {pages}',
    unavailableTitle: 'Môn học chưa sẵn sàng',
    emptyTitle: 'Không có môn học phù hợp',
    emptyDescription:
      'Hãy tạo môn học để lớp học phần và đăng ký cùng dùng một thông tin môn học rõ ràng.',
    tableTitle: 'Bản ghi môn học',
    loadFailed: 'Hiện chưa thể tải môn học.',
    headers: {
      code: 'Mã',
      name: 'Tên môn',
      credits: 'Tín chỉ',
      department: 'Khoa',
      status: 'Trạng thái',
      actions: 'Tác vụ',
    },
    department: 'Khoa',
    allDepartments: 'Tất cả khoa',
    selectDepartment: 'Chọn khoa',
    referenceLoadFailed: 'Hiện chưa thể tải dữ liệu khoa cho bộ lọc và biểu mẫu.',
    unassigned: 'Chưa gán',
    active: 'Đang hoạt động',
    inactive: 'Ngừng hoạt động',
    deleteTitle: 'Xóa môn học',
    deleteMessage: 'Xóa {code}? Hành động này sẽ gỡ môn học khỏi màn hình quản trị hiện tại.',
    deleteConfirm: 'Xóa môn học',
    deleted: 'Đã xóa môn học',
    deleteFailed: 'Hiện chưa thể xóa môn học này.',
    updated: 'Đã cập nhật môn học',
    created: 'Đã tạo môn học',
    saveFailed: 'Hiện chưa thể lưu môn học.',
    staleEdit: 'Môn học đã thay đổi sau khi bạn mở. Các chỉnh sửa vẫn được giữ; hãy tải lại để so sánh trước khi lưu.',
    editTitle: 'Chỉnh sửa môn học',
    createTitle: 'Tạo môn học',
    courseCode: 'Mã môn học',
    creditsLabel: 'Tín chỉ',
    courseName: 'Tên môn học',
    descriptionLabel: 'Mô tả',
    descriptionPlaceholder: 'Ghi chú thêm về môn học (không bắt buộc)',
    fields: {
      englishName: 'Tên tiếng Anh',
      vietnameseName: 'Tên tiếng Việt',
      englishDescription: 'Mô tả tiếng Anh',
      vietnameseDescription: 'Mô tả tiếng Việt',
    },
    saving: 'Đang lưu...',
    editLabel: 'Chỉnh sửa môn học {code}',
    deleteLabel: 'Xóa môn học {code}',
  },
  departments: {
    loading: 'Đang tải khoa',
    title: 'Khoa',
    description:
      'Giữ cấu trúc học thuật rõ ràng để môn học, giảng viên và chương trình có người phụ trách cụ thể.',
    create: 'Tạo khoa',
    searchLabel: 'Tìm khoa',
    searchPlaceholder: 'Tìm theo tên hoặc mã khoa',
    pageSummaryEmpty: 'Không có bản ghi phù hợp',
    pageSummary: 'Trang {currentPage} / {pages}',
    unavailableTitle: 'Khoa chưa sẵn sàng',
    emptyTitle: 'Không có khoa phù hợp',
    emptyDescription:
      'Hãy tạo khoa để môn học, giảng viên và chương trình cùng nằm trong một cấu trúc rõ ràng.',
    tableTitle: 'Bản ghi khoa',
    loadFailed: 'Hiện chưa thể tải danh sách khoa.',
    headers: {
      code: 'Mã',
      name: 'Tên khoa',
      description: 'Mô tả',
      status: 'Trạng thái',
      actions: 'Tác vụ',
    },
    noDescription: 'Chưa có mô tả',
    active: 'Đang hoạt động',
    inactive: 'Ngừng hoạt động',
    deleteTitle: 'Xóa khoa',
    deleteMessage: 'Xóa {name}? Hành động này sẽ gỡ khoa khỏi màn hình quản trị hiện tại.',
    deleteConfirm: 'Xóa khoa',
    deleted: 'Đã xóa khoa',
    deleteFailed: 'Hiện chưa thể xóa khoa này.',
    updated: 'Đã cập nhật khoa',
    created: 'Đã tạo khoa',
    saveFailed: 'Hiện chưa thể lưu khoa.',
    editTitle: 'Chỉnh sửa khoa',
    createTitle: 'Tạo khoa',
    fields: {
      code: 'Mã khoa',
      name: 'Tên khoa',
      description: 'Mô tả',
      englishName: 'Tên tiếng Anh',
      vietnameseName: 'Tên tiếng Việt',
      englishDescription: 'Mô tả tiếng Anh',
      vietnameseDescription: 'Mô tả tiếng Việt',
    },
    banner: {
      eyebrow: 'CƠ CẤU TỔ CHỨC & KHOA ĐÀO TẠO HCMUTE',
      title: 'Quản trị Cơ cấu Khoa & Viện Đào tạo Trọng điểm',
      description:
        'Phân cấp tổ chức học thuật, quản lý các khoa chuyên ngành, phòng thí nghiệm nghiên cứu công nghệ cao và bộ môn trực thuộc phục vụ đào tạo tín chỉ, phân bổ giảng viên và quản lý đồ án tốt nghiệp.',
      unitsLabel: 'Khoa & Đơn vị trực thuộc',
      activeOnPage: 'Đang hoạt động trong trang này',
      curriculumLabel: 'Chuẩn hóa tín chỉ',
      imageAlt: 'Phòng thí nghiệm nghiên cứu Khoa CNTT HCMUTE',
      labLabel: 'Phòng thí nghiệm Hệ thống Thông minh & Robot',
    },
    saving: 'Đang lưu...',
    editLabel: 'Chỉnh sửa khoa {name}',
    deleteLabel: 'Xóa khoa {name}',
  },
  lecturers: {
    loading: 'Đang tải giảng viên',
    title: 'Giảng viên',
    description: 'Giữ hồ sơ giảng dạy gắn đúng người, đúng khoa và đủ thông tin chuyên môn.',
    create: 'Tạo giảng viên',
    searchLabel: 'Tìm giảng viên',
    searchPlaceholder: 'Tìm theo tên, email hoặc mã nhân sự',
    pageSummaryEmpty: 'Không có bản ghi phù hợp',
    pageSummary: 'Trang {currentPage} / {pages}',
    unavailableTitle: 'Giảng viên chưa sẵn sàng',
    emptyTitle: 'Không có giảng viên phù hợp',
    emptyDescription:
      'Hãy tạo hồ sơ giảng viên để lớp học phần, lịch dạy và phân công chấm điểm luôn khớp nhau.',
    tableTitle: 'Bản ghi giảng viên',
    loadFailed: 'Hiện chưa thể tải danh sách giảng viên.',
    headers: {
      employeeId: 'Mã nhân sự',
      lecturer: 'Giảng viên',
      email: 'Email',
      department: 'Khoa',
      specialization: 'Chuyên môn',
      status: 'Trạng thái',
      actions: 'Tác vụ',
    },
    selectDepartment: 'Chọn khoa',
    referenceLoadFailed: 'Hiện chưa thể tải dữ liệu khoa cho biểu mẫu giảng viên.',
    unlinkedAccount: 'Chưa liên kết tài khoản',
    noEmail: 'Chưa có email',
    unassigned: 'Chưa gán',
    notProvided: 'Chưa cập nhật',
    active: 'Đang hoạt động',
    inactive: 'Ngừng hoạt động',
    deleteTitle: 'Xóa giảng viên',
    deleteMessage: 'Xóa {employeeId}? Hành động này sẽ gỡ giảng viên khỏi màn hình quản trị hiện tại.',
    deleteConfirm: 'Xóa giảng viên',
    deleted: 'Đã xóa giảng viên',
    deleteFailed: 'Hiện chưa thể xóa giảng viên này.',
    updated: 'Đã cập nhật giảng viên',
    created: 'Đã tạo giảng viên',
    saveFailed: 'Hiện chưa thể lưu hồ sơ giảng viên.',
    editTitle: 'Chỉnh sửa giảng viên',
    createTitle: 'Tạo giảng viên',
    fields: {
      employeeId: 'Mã nhân sự',
      userId: 'ID tài khoản liên kết',
      userIdPlaceholder: 'ID tài khoản người dùng hiện có',
      department: 'Khoa',
      specialization: 'Chuyên môn',
      specializationPlaceholder: 'Tùy chọn: môn hoặc lĩnh vực phụ trách',
    },
    saving: 'Đang lưu...',
    editLabel: 'Chỉnh sửa giảng viên {employeeId}',
    deleteLabel: 'Xóa giảng viên {employeeId}',
  },
  classrooms: {
    loading: 'Đang tải phòng học',
    title: 'Phòng học',
    description:
      'Giữ dữ liệu phòng học rõ ràng để lớp học phần, lịch học và kế hoạch sức chứa luôn khớp nhau.',
    create: 'Tạo phòng học',
    searchLabel: 'Tìm phòng học',
    searchPlaceholder: 'Tìm theo tòa nhà hoặc số phòng',
    pageSummaryEmpty: 'Không có bản ghi phù hợp',
    pageSummary: 'Trang {currentPage} / {pages}',
    unavailableTitle: 'Phòng học chưa sẵn sàng',
    emptyTitle: 'Không có phòng học phù hợp',
    emptyDescription:
      'Hãy tạo phòng học để việc xếp lớp học phần có nguồn dữ liệu phòng ổn định.',
    tableTitle: 'Bản ghi phòng học',
    loadFailed: 'Hiện chưa thể tải danh sách phòng học.',
    headers: {
      building: 'Tòa nhà',
      room: 'Phòng',
      capacity: 'Sức chứa',
      type: 'Loại phòng',
      status: 'Trạng thái',
      actions: 'Tác vụ',
    },
    fields: {
      building: 'Tòa nhà',
      roomNumber: 'Số phòng',
      capacity: 'Sức chứa',
      type: 'Loại phòng',
    },
    typeOptions: {
      LECTURE: 'Lớp học lý thuyết',
      LAB: 'Phòng thí nghiệm',
      WORKSHOP: 'Phòng workshop',
      SEMINAR: 'Phòng seminar',
      AUDITORIUM: 'Hội trường',
      OTHER: 'Khác',
    },
    active: 'Đang hoạt động',
    inactive: 'Ngừng hoạt động',
    deleteTitle: 'Xóa phòng học',
    deleteMessage:
      'Xóa phòng {building} {roomNumber}? Hành động này sẽ gỡ phòng khỏi màn hình quản trị hiện tại.',
    deleteConfirm: 'Xóa phòng học',
    deleted: 'Đã xóa phòng học',
    deleteFailed: 'Hiện chưa thể xóa phòng học này.',
    updated: 'Đã cập nhật phòng học',
    created: 'Đã tạo phòng học',
    saveFailed: 'Hiện chưa thể lưu phòng học.',
    editTitle: 'Chỉnh sửa phòng học',
    createTitle: 'Tạo phòng học',
    saving: 'Đang lưu...',
    editLabel: 'Chỉnh sửa phòng học {building} {roomNumber}',
    deleteLabel: 'Xóa phòng học {building} {roomNumber}',
  },
  academicYears: {
    loading: 'Đang tải năm học',
    title: 'Năm học',
    description:
      'Giữ lịch học năm học rõ ràng, dễ tìm và có chủ đích trước khi học kỳ và đợt đăng ký dựa vào đó.',
    create: 'Tạo năm học',
    searchLabel: 'Tìm năm học',
    searchPlaceholder: 'Tìm theo năm',
    pageSummaryEmpty: 'Không có bản ghi phù hợp',
    pageSummary: 'Trang {currentPage} / {pages}',
    unavailableTitle: 'Năm học chưa sẵn sàng',
    emptyTitle: 'Không có năm học phù hợp',
    emptyDescription:
      'Hãy tạo năm học mới để kế hoạch học kỳ có một mốc chuẩn rõ ràng.',
    tableTitle: 'Bản ghi năm học',
    loadFailed: 'Hiện chưa thể tải năm học.',
    headers: {
      year: 'Năm',
      startDate: 'Ngày bắt đầu',
      endDate: 'Ngày kết thúc',
      status: 'Trạng thái',
      actions: 'Tác vụ',
    },
    active: 'Đang hoạt động',
    inactive: 'Ngừng hoạt động',
    deleteTitle: 'Xóa năm học',
    deleteMessage:
      'Xóa năm học {year}? Hành động này sẽ gỡ năm học khỏi màn hình quản trị hiện tại.',
    deleteConfirm: 'Xóa năm học',
    deleted: 'Đã xóa năm học',
    deleteFailed: 'Hiện chưa thể xóa năm học này.',
    updated: 'Đã cập nhật năm học',
    created: 'Đã tạo năm học',
    saveFailed: 'Hiện chưa thể lưu năm học.',
    endDateBeforeStart: 'Ngày kết thúc phải sau ngày bắt đầu.',
    editTitle: 'Chỉnh sửa năm học',
    createTitle: 'Tạo năm học',
    yearLabel: 'Năm',
    startDateLabel: 'Ngày bắt đầu',
    endDateLabel: 'Ngày kết thúc',
    saving: 'Đang lưu...',
    editLabel: 'Chỉnh sửa năm học {year}',
    deleteLabel: 'Xóa năm học {year}',
  },
};
