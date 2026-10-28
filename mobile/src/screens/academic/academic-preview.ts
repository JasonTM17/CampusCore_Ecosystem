// Preview-only sample data. Screens show it only when the API mode is
// `preview` and always label it as preview data; live mode never reads this.

import type { AcademicEnrollment, AcademicSemester } from './academic-model';
import type { AcademicGradeRecord, AttendanceSummaryRow } from './academic-api';
import type { BrowseSection } from './registration-browse';

const course = (code: string, name: string, credits: number) => ({ code, name, nameEn: name, nameVi: name, credits });

export const previewSemester: AcademicSemester = { id: 'preview-term', name: 'Preview term', startDate: '2026-01-05', endDate: '2026-05-30', status: 'IN_PROGRESS' };

export const previewEnrollments: AcademicEnrollment[] = [
  {
    id: 'preview-cs204', sectionId: 'preview-sec-cs204', semesterId: previewSemester.id, status: 'ENROLLED', gradeStatus: 'NOT_GRADED',
    section: { sectionNumber: '01', course: course('CS204', 'Software Architecture', 3), lecturer: { fullName: 'Dr. Le Minh' }, schedules: [{ dayOfWeek: 3, startTime: '08:00', endTime: '09:30', classroom: { building: 'A2', roomNumber: '204' } }] },
  },
  {
    id: 'preview-ba312', sectionId: 'preview-sec-ba312', semesterId: previewSemester.id, status: 'ENROLLED', gradeStatus: 'NOT_GRADED',
    section: { sectionNumber: '02', course: course('BA312', 'Business Analytics', 3), lecturer: { fullName: 'Assoc. Prof. Tran Ha' }, schedules: [{ dayOfWeek: 5, startTime: '13:30', endTime: '15:00', classroom: { building: 'B1', roomNumber: '108' } }] },
  },
  {
    id: 'preview-en201', sectionId: 'preview-sec-en201', semesterId: 'preview-old', status: 'COMPLETED', gradeStatus: 'PUBLISHED', finalGrade: 8.8, letterGrade: 'A',
    section: { sectionNumber: '03', course: course('EN201', 'Academic English', 2) },
  },
];

export const previewGrades: AcademicGradeRecord[] = [
  { id: 'preview-g-cs204', courseCode: 'CS204', courseName: 'Software Architecture', credits: 3, finalGrade: 9.1, letterGrade: 'A+', gradeStatus: 'PUBLISHED', enrollmentStatus: 'COMPLETED', semesterId: previewSemester.id },
  { id: 'preview-g-ba312', courseCode: 'BA312', courseName: 'Business Analytics', credits: 3, finalGrade: 8.4, letterGrade: 'B+', gradeStatus: 'PUBLISHED', enrollmentStatus: 'COMPLETED', semesterId: previewSemester.id },
];

export const previewAttendance: AttendanceSummaryRow[] = [
  { sectionId: 'preview-sec-cs204', courseCode: 'CS204', courseName: 'Software Architecture', total: 16, present: 15, absent: 1, late: 0, excused: 0, attendanceRate: 94 },
  { sectionId: 'preview-sec-ba312', courseCode: 'BA312', courseName: 'Business Analytics', total: 15, present: 14, absent: 1, late: 0, excused: 0, attendanceRate: 93 },
];

export const previewSections: BrowseSection[] = [
  { id: 'preview-cs401', sectionNumber: '01', courseId: 'cs401', courseCode: 'CS401', courseName: 'Distributed Systems', credits: 3, capacity: 40, enrolledCount: 28, remainingSeats: 12, status: 'OPEN', curriculumRelevance: 'MANDATORY', schedules: [{ dayOfWeek: 3, startTime: '10:00', endTime: '11:30', room: 'A3.201', lecturer: null }] },
  { id: 'preview-ux305', sectionNumber: '01', courseId: 'ux305', courseCode: 'UX305', courseName: 'Service Design', credits: 2, capacity: 30, enrolledCount: 25, remainingSeats: 5, status: 'OPEN', curriculumRelevance: 'ELECTIVE', schedules: [{ dayOfWeek: 5, startTime: '13:30', endTime: '15:00', room: 'C2.105', lecturer: null }] },
];
