/**
 * Student-portal copy: dashboard home, grades, course/enrolment records,
 * profile, the grade-detail dialog, the notifications open-link label, and the
 * public homepage portal lanes.
 *
 * These pages each carried their own inline `locale === 'vi' ? ... : ...`
 * dictionary. The copy below keeps the original key paths 1:1, so the page
 * groups mirror the dictionary that used to live inside the page:
 * `home.*`, `grades.*`, `enrollments.*`, `gradeDetail.*`, `profile.*`,
 * `notifications.*`, and `identity.*`.
 *
 * String values keep `{token}` placeholders where the two locales order the
 * interpolation differently; call sites fill them with
 * `.replace('{token}', () => value)`, the same contract as
 * `messages-admin-academics.ts`.
 *
 * The fragment is consumed through a direct import (`studentPortalEn` /
 * `studentPortalVi` selected by the locale hook) so these pages work before the
 * integrator mounts it on the root catalogue as `studentPortal`.
 */

export interface StudentPortalCopy {
  home: {
    stats: {
      courses: string;
      active: string;
      pending: string;
      term: string;
    };
    upcomingTitle: string;
    today: string;
    tomorrow: string;
    noMeetings: string;
    openSchedule: string;
    progressTitle: string;
    creditLabel: string;
    /** `{percent}` is the rounded share of the term credit cap. */
    progressStatus: string;
    /** `{remaining}` is the number of credits still registrable. */
    creditsAvailable: string;
    creditsCapped: string;
    creditsEarnedOnly: string;
    /** `{count}` is the number of PENDING registrations. */
    pendingBadge: string;
    pendingBadgeOne: string;
    quickAccessTitle: string;
    coursesUnit: string;
    shifts: {
      morning: string;
      afternoon: string;
      evening: string;
    };
    /** Monday..Sunday abbreviations, indexed by ISO day minus one. */
    dayShort: readonly string[];
    /** `{building}` and `{room}` form the classroom line. */
    roomWithBuilding: string;
    /** `{room}` renders when only the room number is known. */
    roomOnly: string;
    tooltips: {
      courses: string;
      active: string;
      pending: string;
      term: string;
    };
  };
  grades: {
    eyebrow: string;
    title: string;
    selectSemester: string;
    allSemesters: string;
    /** Lower-case form used as the localized-name fallback. */
    allSemestersFallback: string;
    openTranscript: string;
    loading: string;
    loadFailed: string;
    unavailableTitle: string;
    emptyTitle: string;
    emptyDescription: string;
    currentGpa: string;
    completedCredits: string;
    gradedCourses: string;
    courseWord: string;
    coursesWord: string;
    creditsWord: string;
    componentSummary: string;
    /** `{courseCode}` and `{courseName}` name the opened record. */
    openBreakdown: string;
    tableHeaders: {
      course: string;
      section: string;
      lecturer: string;
      credits: string;
      processScore: string;
      finalExamScore: string;
      score: string;
      grade: string;
      status: string;
    };
    pendingAssignment: string;
    notPublished: string;
  };
  enrollments: {
    eyebrow: string;
    title: string;
    description: string;
    browseSections: string;
    loading: string;
    curriculumLoading: string;
    curriculumLoadFailed: string;
    unavailableTitle: string;
    emptyTitle: string;
    emptyDescription: string;
    tabCurriculum: string;
    tabCurriculumShort: string;
    tabEnrollments: string;
    tabEnrollmentsShort: string;
    statCurriculumTotal: string;
    statCompleted: string;
    statInProgress: string;
    statRemaining: string;
    curriculumProgressLabel: string;
    statusSummaryLabel: string;
    courseWord: string;
    coursesWord: string;
    filterAll: string;
    filterCompleted: string;
    filterInProgress: string;
    filterNotStarted: string;
    yearPrefix: string;
    semesterPrefix: string;
    mandatory: string;
    elective: string;
    prerequisiteChip: string;
    prerequisiteHint: string;
    creditsLabel: string;
    gradeScore: string;
    noCurriculumCourses: string;
    sectionPrefix: string;
    enrolledOn: string;
    unknownCourse: string;
    unavailableCourseName: string;
    unknownSection: string;
    unknownSemester: string;
    colCourse: string;
    colSection: string;
    colSchedule: string;
    colStatus: string;
    colActions: string;
    dropCourse: string;
    droppingCourse: string;
    confirmTitle: string;
    /** `{courseLabel}` is the course code plus its localized name. */
    confirmMessage: string;
    dropped: string;
    dropFailed: string;
    exportSlip: string;
    exportSlipDownloading: string;
    exportSlipSuccess: string;
    exportUnavailable: string;
    studentProfileMissing: string;
    loadFailed: string;
  };
  gradeDetail: {
    emptyValue: string;
    title: string;
    credits: string;
    componentsTitle: string;
    formula: string;
    detailFailed: string;
    loading: string;
    empty: string;
    component: string;
    weight: string;
    score: string;
    finalScore: string;
    letterGrade: string;
    gradePoint: string;
    processItem: string;
    finalItem: string;
  };
  profile: {
    demoAccount: string;
    demoAccountShort: string;
  };
  notifications: {
    openRelated: string;
  };
  identity: {
    student: string;
    lecturer: string;
    admin: string;
  };
}

export const studentPortalEn: StudentPortalCopy = {
  home: {
    stats: {
      courses: 'Courses this term',
      active: 'Active',
      pending: 'Pending',
      term: 'Current term',
    },
    upcomingTitle: 'Today & upcoming classes',
    today: 'Today',
    tomorrow: 'Tomorrow',
    noMeetings: 'No class meetings scheduled yet.',
    openSchedule: 'Open schedule',
    progressTitle: 'Study progress',
    creditLabel: 'Credits this term',
    progressStatus: '{percent}% of term credit capacity',
    creditsAvailable: 'Can register up to {remaining} more credits',
    creditsCapped: 'Maximum credit limit reached',
    creditsEarnedOnly: 'Credits registered this term',
    pendingBadge: '{count} registrations pending',
    pendingBadgeOne: '{count} registration pending',
    quickAccessTitle: 'Quick access',
    coursesUnit: 'courses',
    shifts: {
      morning: 'Morning',
      afternoon: 'Afternoon',
      evening: 'Evening',
    },
    dayShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    roomWithBuilding: 'Room {building}-{room}',
    roomOnly: 'Room {room}',
    tooltips: {
      courses: 'View enrolled courses',
      active: 'View active courses',
      pending: 'Go to course registration',
      term: 'View semester schedule',
    },
  },
  grades: {
    eyebrow: 'Student area',
    title: 'Grades',
    selectSemester: 'Select semester for grades',
    allSemesters: 'All semesters',
    allSemestersFallback: 'all semesters',
    openTranscript: 'Open transcript',
    loading: 'Loading grades',
    loadFailed: 'Grades could not be loaded.',
    unavailableTitle: 'Grades unavailable',
    emptyTitle: 'No grades published yet',
    emptyDescription:
      'Once courses are graded and published, the results will appear here.',
    currentGpa: 'Current GPA',
    completedCredits: 'Completed credits',
    gradedCourses: 'Graded courses',
    courseWord: 'course',
    coursesWord: 'courses',
    creditsWord: 'credits',
    componentSummary: 'Component scores by course',
    openBreakdown: 'Open grade breakdown for {courseCode} {courseName}',
    tableHeaders: {
      course: 'Course',
      section: 'Class',
      lecturer: 'Lecturer',
      credits: 'Credits',
      processScore: 'Coursework (50%)',
      finalExamScore: 'Final Exam (50%)',
      score: 'Total (10)',
      grade: 'Grade',
      status: 'Status',
    },
    pendingAssignment: 'Pending assignment',
    notPublished: 'Not published',
  },
  enrollments: {
    eyebrow: 'Student area',
    title: 'My courses',
    description: 'Track your curriculum and enrolled class sections.',
    browseSections: 'Browse classes',
    loading: 'Loading courses & study program',
    curriculumLoading: 'Loading curriculum',
    curriculumLoadFailed: 'Your curriculum could not be loaded.',
    unavailableTitle: 'Course information unavailable',
    emptyTitle: 'No courses yet',
    emptyDescription:
      'Once you enroll in a class, its schedule and details will appear here.',
    tabCurriculum: 'Curriculum Roadmap',
    tabCurriculumShort: 'Curriculum',
    tabEnrollments: 'Enrollment Records',
    tabEnrollmentsShort: 'Enrolled',
    statCurriculumTotal: 'Total Curriculum Courses',
    statCompleted: 'Completed',
    statInProgress: 'In Progress',
    statRemaining: 'Not completed',
    curriculumProgressLabel: 'Credit progress',
    statusSummaryLabel: 'Curriculum status summary',
    courseWord: 'course',
    coursesWord: 'courses',
    filterAll: 'All courses',
    filterCompleted: 'Completed',
    filterInProgress: 'In Progress',
    filterNotStarted: 'Not completed',
    yearPrefix: 'Year',
    semesterPrefix: 'Semester',
    mandatory: 'Mandatory',
    elective: 'Elective',
    prerequisiteChip: 'Prerequisites:',
    prerequisiteHint:
      'Must be completed with a passing grade before registering this course',
    creditsLabel: 'credits',
    gradeScore: 'Grade',
    noCurriculumCourses: 'No courses found for the selected status filter.',
    sectionPrefix: 'Class',
    enrolledOn: 'Enrolled',
    unknownCourse: 'Course',
    unavailableCourseName: 'Unavailable',
    unknownSection: 'Unknown class',
    unknownSemester: 'Unknown semester',
    colCourse: 'Course',
    colSection: 'Class',
    colSchedule: 'Schedule',
    colStatus: 'Status',
    colActions: 'Actions',
    dropCourse: 'Drop course',
    droppingCourse: 'Dropping course',
    confirmTitle: 'Drop course',
    confirmMessage:
      'Drop {courseLabel}? This keeps the action explicit and prevents accidental schedule changes.',
    dropped: 'Course dropped',
    dropFailed: 'We could not drop this course.',
    exportSlip: 'Download registration slip (PDF)',
    exportSlipDownloading: 'Downloading slip...',
    exportSlipSuccess: 'Registration slip downloaded.',
    exportUnavailable: 'A registration slip is not available yet.',
    studentProfileMissing:
      'Your student profile is not available in this session.',
    loadFailed: 'Your current enrollments could not be loaded.',
  },
  gradeDetail: {
    emptyValue: 'N/A',
    title: 'Course Grade Breakdown',
    credits: 'credits',
    componentsTitle: 'Course Grade Components (50% Coursework + 50% Final)',
    formula: 'Final = Coursework × 50% + Exam × 50%',
    detailFailed:
      'Could not load the latest component scores — the table below shows saved summary scores and may be incomplete.',
    loading: 'Loading grade breakdown...',
    empty: 'No grade breakdown available for this course yet.',
    component: 'Component',
    weight: 'Weight',
    score: 'Score',
    finalScore: 'Final Score (10)',
    letterGrade: 'Letter Grade',
    gradePoint: 'Grade Point',
    processItem: 'Coursework (50%)',
    finalItem: 'Final exam score (50%)',
  },
  profile: {
    demoAccount: 'Demo experience account',
    demoAccountShort: 'Demo account',
  },
  notifications: {
    openRelated: 'Open related feature',
  },
  identity: {
    student: 'Enter Student Portal',
    lecturer: 'Enter Lecturer Portal',
    admin: 'Enter Admin Portal',
  },
};

export const studentPortalVi: StudentPortalCopy = {
  home: {
    stats: {
      courses: 'Môn học kỳ này',
      active: 'Đang học',
      pending: 'Chờ xử lý',
      term: 'Học kỳ hiện tại',
    },
    upcomingTitle: 'Lịch học hôm nay & sắp tới',
    today: 'Hôm nay',
    tomorrow: 'Ngày mai',
    noMeetings: 'Chưa có buổi học nào được xếp lịch.',
    openSchedule: 'Xem thời khóa biểu',
    progressTitle: 'Tiến độ học tập',
    creditLabel: 'Tín chỉ đăng ký kỳ này',
    progressStatus: 'Đã đạt {percent}% chỉ tiêu học kỳ',
    creditsAvailable: 'Còn có thể đăng ký thêm {remaining} tín chỉ',
    creditsCapped: 'Đã đạt hạn mức tín chỉ tối đa',
    creditsEarnedOnly: 'Tín chỉ đã đăng ký kỳ này',
    pendingBadge: '{count} đăng ký chờ xử lý',
    pendingBadgeOne: '{count} đăng ký chờ xử lý',
    quickAccessTitle: 'Truy cập nhanh',
    coursesUnit: 'môn',
    shifts: {
      morning: 'Ca Sáng',
      afternoon: 'Ca Chiều',
      evening: 'Ca Tối',
    },
    dayShort: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
    roomWithBuilding: 'Phòng {building}-{room}',
    roomOnly: 'Phòng {room}',
    tooltips: {
      courses: 'Xem danh sách học phần',
      active: 'Xem các môn đang học',
      pending: 'Đến trang đăng ký học phần',
      term: 'Xem thời khóa biểu học kỳ',
    },
  },
  grades: {
    eyebrow: 'Cổng Sinh viên',
    title: 'Điểm số',
    selectSemester: 'Chọn học kỳ cho điểm số',
    allSemesters: 'Tất cả học kỳ',
    allSemestersFallback: 'tất cả học kỳ',
    openTranscript: 'Mở bảng điểm',
    loading: 'Đang tải điểm số',
    loadFailed: 'Hiện chưa thể tải dữ liệu điểm số.',
    unavailableTitle: 'Điểm số chưa sẵn sàng',
    emptyTitle: 'Chưa có điểm được công bố',
    emptyDescription: 'Khi môn học được chấm và công bố, kết quả sẽ xuất hiện tại đây.',
    currentGpa: 'GPA hiện tại',
    completedCredits: 'Tín chỉ hoàn tất',
    gradedCourses: 'Môn đã có điểm',
    courseWord: 'môn',
    coursesWord: 'môn',
    creditsWord: 'tín chỉ',
    componentSummary: 'Điểm thành phần theo từng môn',
    openBreakdown: 'Mở chi tiết điểm cho {courseCode} {courseName}',
    tableHeaders: {
      course: 'Môn học',
      section: 'Lớp học phần',
      lecturer: 'Giảng viên',
      credits: 'Tín chỉ',
      processScore: 'Quá trình (50%)',
      finalExamScore: 'Cuối kỳ (50%)',
      score: 'Điểm HP (10)',
      grade: 'Điểm chữ',
      status: 'Trạng thái',
    },
    pendingAssignment: 'Chờ phân công',
    notPublished: 'Chưa công bố',
  },
  enrollments: {
    eyebrow: 'Cổng Sinh viên',
    title: 'Môn học của tôi',
    description: 'Theo dõi chương trình đào tạo và các lớp đã đăng ký.',
    browseSections: 'Xem lớp học phần',
    loading: 'Đang tải thông tin môn học & CTĐT',
    curriculumLoading: 'Đang tải chương trình đào tạo',
    curriculumLoadFailed: 'Không tải được chương trình đào tạo.',
    unavailableTitle: 'Thông tin môn học chưa sẵn sàng',
    emptyTitle: 'Chưa có môn học',
    emptyDescription:
      'Khi bạn đăng ký một lớp học phần, lịch học và thông tin lớp sẽ xuất hiện ở đây.',
    tabCurriculum: 'Chương trình đào tạo (CTĐT)',
    tabCurriculumShort: 'CTĐT',
    tabEnrollments: 'Hồ sơ đăng ký học phần',
    tabEnrollmentsShort: 'Đăng ký',
    statCurriculumTotal: 'Tổng môn học CTĐT',
    statCompleted: 'Đã hoàn tất',
    statInProgress: 'Đang học',
    statRemaining: 'Chưa hoàn tất',
    curriculumProgressLabel: 'Tiến độ tín chỉ',
    statusSummaryLabel: 'Tóm tắt trạng thái CTĐT',
    courseWord: 'môn',
    coursesWord: 'môn',
    filterAll: 'Tất cả môn',
    filterCompleted: 'Đã hoàn tất',
    filterInProgress: 'Đang học',
    filterNotStarted: 'Chưa hoàn tất',
    yearPrefix: 'Năm học',
    semesterPrefix: 'Học kỳ',
    mandatory: 'Bắt buộc',
    elective: 'Tự chọn',
    prerequisiteChip: 'Tiên quyết:',
    prerequisiteHint: 'Phải hoàn thành và đạt trước khi đăng ký môn này',
    creditsLabel: 'tín chỉ',
    gradeScore: 'Điểm',
    noCurriculumCourses: 'Không có môn học nào thuộc nhóm trạng thái này.',
    sectionPrefix: 'Lớp học phần',
    enrolledOn: 'Đăng ký ngày',
    unknownCourse: 'Môn học',
    unavailableCourseName: 'Chưa có tên môn',
    unknownSection: 'Chưa rõ lớp học phần',
    unknownSemester: 'Chưa rõ học kỳ',
    colCourse: 'Môn học',
    colSection: 'Lớp HP',
    colSchedule: 'Lịch học',
    colStatus: 'Trạng thái',
    colActions: 'Tác vụ',
    dropCourse: 'Hủy môn học',
    droppingCourse: 'Đang hủy môn',
    confirmTitle: 'Hủy môn học',
    confirmMessage:
      'Hủy {courseLabel}? Hành động này giữ cho việc đổi lịch học luôn rõ ràng và có chủ đích.',
    dropped: 'Đã hủy môn học',
    dropFailed: 'Hiện chưa thể hủy môn học này.',
    exportSlip: 'Xuất phiếu đăng ký (PDF)',
    exportSlipDownloading: 'Đang tải phiếu...',
    exportSlipSuccess: 'Đã tải phiếu đăng ký học phần (PDF).',
    exportUnavailable: 'Phiếu đăng ký chưa sẵn sàng.',
    studentProfileMissing:
      'Không tìm thấy hồ sơ sinh viên trong phiên hiện tại.',
    loadFailed: 'Hiện chưa thể tải danh sách môn học của bạn.',
  },
  gradeDetail: {
    emptyValue: 'Chưa có',
    title: 'Chi tiết điểm học phần',
    credits: 'tín chỉ',
    componentsTitle: 'Thành phần điểm học phần (50% Quá trình + 50% Cuối kỳ)',
    formula: 'ĐHP = ĐQT × 50% + ĐCK × 50%',
    detailFailed:
      'Không tải được điểm thành phần mới nhất — bảng dưới hiển thị điểm tóm tắt đã lưu, có thể chưa đầy đủ.',
    loading: 'Đang tải điểm chi tiết...',
    empty: 'Chưa có dữ liệu điểm thành phần cho học phần này.',
    component: 'Thành phần',
    weight: 'Trọng số',
    score: 'Điểm số',
    finalScore: 'Điểm tổng kết (10)',
    letterGrade: 'Điểm chữ',
    gradePoint: 'Quy đổi (4.0)',
    processItem: 'Điểm quá trình (ĐQT - 50%)',
    finalItem: 'Điểm cuối kỳ (ĐCK - 50%)',
  },
  profile: {
    demoAccount: 'Tài khoản demo để trải nghiệm',
    demoAccountShort: 'Tài khoản demo',
  },
  notifications: {
    openRelated: 'Mở tính năng liên quan',
  },
  identity: {
    student: 'Vào Cổng Sinh viên',
    lecturer: 'Vào Cổng Giảng viên',
    admin: 'Vào Cổng Quản trị',
  },
};
