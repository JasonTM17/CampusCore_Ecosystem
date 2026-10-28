import type { AttendanceRosterEntry, LecturerGradingSection, LecturerScheduleEntry, StudentGradeRow } from '../../../api/client';

export const previewSchedule: LecturerScheduleEntry[] = [
  {
    sectionId: 'preview-cs204',
    sectionNumber: '02',
    courseCode: 'CS204',
    courseName: 'Software Architecture',
    enrolledCount: 16,
    schedules: [{ dayOfWeek: 2, startTime: '08:00', endTime: '09:30', classroom: { building: 'A2', roomNumber: '204' } }],
  },
  {
    sectionId: 'preview-ba312',
    sectionNumber: '01',
    courseCode: 'BA312',
    courseName: 'Business Analytics',
    enrolledCount: 18,
    schedules: [{ dayOfWeek: 2, startTime: '13:30', endTime: '15:00', classroom: { building: 'B1', roomNumber: '108' } }],
  },
];

export const previewGrading: LecturerGradingSection[] = [
  { sectionId: 'preview-cs204', courseCode: 'CS204', courseName: 'Software Architecture', enrolledCount: 16, gradedCount: 10, publishedCount: 0, canPublish: true, gradeStatus: 'DRAFT' },
  { sectionId: 'preview-ba312', courseCode: 'BA312', courseName: 'Business Analytics', enrolledCount: 18, gradedCount: 18, publishedCount: 18, canPublish: false, gradeStatus: 'PUBLISHED' },
];

export const previewRoster: AttendanceRosterEntry[] = [
  { studentId: 'st-1', studentCode: '2022SE0417', firstName: 'Duc Minh', lastName: 'Nguyen' },
  { studentId: 'st-2', studentCode: '2023BA0192', firstName: 'Anh Thu', lastName: 'Pham' },
  { studentId: 'st-3', studentCode: '2024IT0871', firstName: 'Khanh Vy', lastName: 'Le' },
];

export const previewGrades: StudentGradeRow[] = [
  { enrollmentId: 'enr-1', studentCode: '2022SE0417', studentName: 'Nguyen Duc Minh', processScore: 8.5, finalExamScore: 9.1, gradeStatus: 'DRAFT' },
  { enrollmentId: 'enr-2', studentCode: '2023BA0192', studentName: 'Pham Anh Thu', processScore: 8.0, finalExamScore: 8.6, gradeStatus: 'DRAFT' },
  { enrollmentId: 'enr-3', studentCode: '2024IT0871', studentName: 'Le Khanh Vy', processScore: null, finalExamScore: null, gradeStatus: 'DRAFT' },
];
