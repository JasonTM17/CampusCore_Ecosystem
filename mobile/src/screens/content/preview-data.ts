// Preview-only sample data. The screens show it only when the API client is in
// `preview` mode and always label it as preview data; live mode never reads it.

import type {
  MobileCareerOpportunity,
  MobileEvent,
  MobileEventRegistration,
  MobileLearningAssignment,
  MobileLearningMaterial,
  MobileLearningSection,
  MobileLibraryLoan,
  MobileLibraryTitle,
  MobileNotification,
  MobilePublicAnnouncement,
  MobilePublicDoc,
} from '../../api/client';
import type { AdmissionApplicationView, CareerApplicationView } from './content-api';

type Locale = 'vi' | 'en';
const pick = <T>(locale: Locale, vi: T, en: T): T => (locale === 'vi' ? vi : en);

export const previewNews = (locale: Locale): MobilePublicAnnouncement[] => [
  {
    id: 'preview-news-1',
    title: pick(locale, 'Lịch thi cuối kỳ', 'Final exam schedule'),
    summary: pick(locale, 'Phòng Đào tạo công bố lịch thi cuối kỳ.', 'The Academic Office published the final exam schedule.'),
    content: pick(locale, 'Sinh viên đăng nhập để xem lịch thi theo lớp học phần.', 'Sign in to see the exam schedule for each section.'),
    priority: 'HIGH',
    publishAt: '2026-10-20T01:00:00Z',
  },
  {
    id: 'preview-news-2',
    title: pick(locale, 'Hội thảo công nghệ sinh viên', 'Student technology conference'),
    summary: pick(locale, 'Đăng ký tham gia hội thảo do khoa CNTT tổ chức.', 'Register for the conference hosted by the IT faculty.'),
    content: pick(locale, 'Hội thảo diễn ra vào tháng 11 tại hội trường A.', 'The conference takes place in November in hall A.'),
    priority: 'NORMAL',
    publishAt: '2026-10-18T01:00:00Z',
  },
];

export const previewDocs = (locale: Locale): MobilePublicDoc[] => [
  {
    slug: 'preview-doc-1',
    categoryId: 'regulations',
    publishedRevision: 2,
    titleVi: 'Quy chế đào tạo tín chỉ',
    titleEn: 'Credit training regulations',
    summaryVi: 'Quy định về đăng ký học phần, tính điểm và tốt nghiệp.',
    summaryEn: 'Rules on course registration, grading and graduation.',
    bodyVi: 'Quy chế quy định khung chương trình, điều kiện đăng ký học phần, thang điểm và tiêu chuẩn tốt nghiệp.',
    bodyEn: 'The regulation covers the programme framework, registration rules, grading scale and graduation requirements.',
    publishedAt: '2026-10-15T01:00:00Z',
    tagIds: [pick(locale, 'quy-che', 'regulation')],
  },
];

export const previewAnnouncements = (locale: Locale): MobilePublicAnnouncement[] => [
  {
    id: 'preview-ann-1',
    title: pick(locale, 'Mở đăng ký học phần học kỳ mới', 'Registration opens for the new term'),
    content: pick(locale, 'Thời gian đăng ký theo kế hoạch của Phòng Đào tạo.', 'Registration follows the Academic Office schedule.'),
    priority: 'URGENT',
    publishAt: '2026-10-25T01:00:00Z',
    lecturerDisplayName: pick(locale, 'Phòng Đào tạo', 'Academic Office'),
  },
];

export const previewEvents = (locale: Locale): MobileEvent[] => [
  {
    id: 'preview-event-1',
    title: pick(locale, 'Ngày hội tình nguyện', 'Volunteer fair'),
    organizer: pick(locale, 'Đoàn Thanh niên', 'Youth Union'),
    location: pick(locale, 'Hội trường A', 'Hall A'),
    status: 'REGISTRATION_OPEN',
    capacity: 120,
    registeredCount: 84,
    seatsRemaining: 36,
    startsAt: '2026-11-05T07:30:00Z',
    endsAt: '2026-11-05T10:30:00Z',
    myRegistrationId: null,
    myRegistrationStatus: null,
    myAttendanceStatus: null,
  },
  {
    id: 'preview-event-2',
    title: pick(locale, 'Hội thảo kỹ năng mềm', 'Soft-skills workshop'),
    organizer: pick(locale, 'Hội Sinh viên', 'Student Association'),
    location: 'B2.04',
    status: 'PUBLISHED',
    capacity: 40,
    registeredCount: 0,
    seatsRemaining: 40,
    startsAt: '2026-11-21T08:00:00Z',
    endsAt: '2026-11-21T10:00:00Z',
    myRegistrationId: null,
    myRegistrationStatus: null,
    myAttendanceStatus: null,
  },
];

export const previewRegistrations: MobileEventRegistration[] = [];

export const previewLibraryTitles = (locale: Locale): MobileLibraryTitle[] => [
  { id: 'preview-title-1', title: pick(locale, 'Nhập môn cấu trúc dữ liệu', 'Introduction to data structures'), author: 'Demo Author', category: 'CNTT', totalCopies: 3, availableCopies: 2, version: 1 },
  { id: 'preview-title-2', title: pick(locale, 'Cơ sở dữ liệu nâng cao', 'Advanced databases'), author: 'Demo Author', category: 'CNTT', totalCopies: 1, availableCopies: 0, version: 1 },
];

export const previewLibraryLoans = (locale: Locale): MobileLibraryLoan[] => [
  {
    id: 'preview-loan-1',
    copyId: 'preview-copy-1',
    barcode: 'BAR-0001',
    title: pick(locale, 'Nhập môn cấu trúc dữ liệu', 'Introduction to data structures'),
    borrowerUserId: 'preview-user',
    status: 'ISSUED',
    requestedAt: '2026-10-01T00:00:00Z',
    issuedAt: '2026-10-03T00:00:00Z',
    dueAt: '2026-10-17T00:00:00Z',
    version: 3,
    createdAt: '2026-10-01T00:00:00Z',
  },
];

export const previewOpportunities = (locale: Locale): MobileCareerOpportunity[] => [
  {
    id: 'preview-opp-1',
    organizationId: 'preview-org',
    organizationName: 'UTE Tech Partners',
    title: pick(locale, 'Thực tập sinh Backend', 'Backend intern'),
    location: pick(locale, 'TP. Hồ Chí Minh', 'Ho Chi Minh City'),
    employmentType: 'INTERNSHIP',
    status: 'PUBLISHED',
    version: 1,
    createdAt: '2026-10-01T00:00:00Z',
  },
];

export const previewCareerApplications = (locale: Locale): CareerApplicationView[] => [
  {
    id: 'preview-capp-1',
    opportunityId: 'preview-opp-1',
    opportunityTitle: pick(locale, 'Thực tập sinh Backend', 'Backend intern'),
    organizationId: 'preview-org',
    organizationName: 'UTE Tech Partners',
    candidateUserId: 'preview-user',
    status: 'REVIEWING',
    submittedAt: '2026-10-02T00:00:00Z',
    version: 2,
    createdAt: '2026-10-02T00:00:00Z',
    attachments: [],
  },
];

export const previewAdmissions = (locale: Locale): AdmissionApplicationView[] => [
  {
    id: 'preview-adm-1',
    applicantUserId: 'preview-user',
    cycle: '2026-Q1-DEMO',
    status: 'RETURNED',
    fullName: pick(locale, 'Nguyễn Văn A', 'Nguyen Van A'),
    dateOfBirth: '2008-01-15',
    schoolName: 'THPT Demo',
    intendedMajor: 'CNTT',
    version: 5,
    createdAt: '2026-10-01T00:00:00Z',
    attachments: [],
    reviews: [
      { id: 'rev-1', action: 'CLAIM', createdAt: '2026-10-02T00:00:00Z' },
      { id: 'rev-2', action: 'RETURN', note: pick(locale, 'Bổ sung bảng điểm', 'Please add your transcript'), createdAt: '2026-10-03T00:00:00Z' },
    ],
  },
];

export const previewLearningSections: MobileLearningSection[] = [
  { sectionId: 'preview-sec-1', sectionNumber: '01', courseCode: 'CS101', courseName: 'Introduction to Programming', enrollmentStatus: 'ENROLLED', materialCount: 1, assignmentCount: 1 },
];

export const previewMaterials = (locale: Locale): MobileLearningMaterial[] => [
  { id: 'preview-mat-1', sectionId: 'preview-sec-1', title: pick(locale, 'Tuần 1: đề cương', 'Week 1: syllabus'), fileName: 'week1.pdf', version: 1 },
];

export const previewAssignments = (locale: Locale): MobileLearningAssignment[] => [
  { id: 'preview-asg-1', sectionId: 'preview-sec-1', title: pick(locale, 'Bài thực hành 1', 'Lab 1'), deadlineAt: '2026-11-15T23:59:00Z', maxScore: 10, status: 'PUBLISHED', version: 1, mySubmissionId: null, mySubmissionStatus: null },
];

export const previewNotifications = (locale: Locale): MobileNotification[] => [
  { id: 'preview-n1', title: pick(locale, 'Mở đăng ký đề tài luận văn', 'Thesis topic registration opens'), message: pick(locale, 'Chọn đề tài trước ngày 30/8.', 'Choose a topic before 30 August.'), isRead: false, createdAt: '2026-10-28T08:00:00Z' },
  { id: 'preview-n2', title: pick(locale, 'Đã công bố điểm CS204', 'CS204 grade published'), message: pick(locale, 'Kết quả đồ án cuối kỳ đã sẵn sàng.', 'Your final project result is ready.'), isRead: false, createdAt: '2026-10-28T06:00:00Z' },
  { id: 'preview-n3', title: pick(locale, 'Bảo trì thư viện', 'Library maintenance'), message: pick(locale, 'Gia hạn trực tuyến tạm dừng cuối tuần.', 'Online renewals pause this weekend.'), isRead: true, createdAt: '2026-10-27T08:00:00Z' },
];

export const previewConduct = (locale: Locale) => ({
  studentCode: '22110000',
  fullName: pick(locale, 'Nguyễn Văn A', 'Nguyen Van A'),
  cumulativeAverageScore: 84,
  cumulativeClassificationVi: 'Tốt',
  currentSemester: {
    id: 'preview-conduct-2',
    semesterName: pick(locale, 'Học kỳ 2', 'Semester 2'),
    totalScore: 86,
    classificationVi: 'Tốt',
    status: 'APPROVED',
    criteria: [
      { code: 'C1', nameVi: 'Ý thức học tập', nameEn: 'Study attitude', score: 18, maxScore: 20 },
      { code: 'C2', nameVi: 'Nội quy nhà trường', nameEn: 'School rules', score: 22, maxScore: 25 },
    ],
    activities: [
      { id: 'preview-act-1', title: pick(locale, 'Mùa hè xanh', 'Green summer'), category: pick(locale, 'Tình nguyện', 'Volunteering'), activityDate: '2026-07-10', points: 3 },
    ],
  },
  history: [
    { id: 'preview-conduct-1', semesterName: pick(locale, 'Học kỳ 1', 'Semester 1'), totalScore: 82, classificationVi: 'Tốt', status: 'APPROVED', criteria: [], activities: [] },
  ],
});

export const previewCurriculum = {
  curriculum: { id: 'preview-cur', code: 'CNTT', name: 'Công nghệ thông tin', nameVi: 'Công nghệ thông tin', nameEn: 'Information Technology', totalCredits: 130 },
  courses: [
    { courseId: 'c1', code: 'CS101', name: 'Intro', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'COMPLETED' as const },
    { courseId: 'c2', code: 'CS204', name: 'Architecture', credits: 3, year: 2, semester: 1, isMandatory: true, status: 'IN_PROGRESS' as const },
  ],
};
