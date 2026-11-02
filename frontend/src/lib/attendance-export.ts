import type { AttendanceStatus } from './api';
import { getMessages } from '@/i18n/messages';

export interface AttendanceExportStudent {
  studentId: string;
  studentCode: string;
  studentName: string;
  status: AttendanceStatus | null;
  notes?: string;
}

export interface AttendanceExportMetrics {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
}

export interface AttendanceCsvOptions {
  sectionNumber: string;
  courseCode?: string;
  courseName?: string;
  date: string;
  lecturerName?: string;
  semesterName?: string;
  metrics: AttendanceExportMetrics;
  students: AttendanceExportStudent[];
  locale?: 'vi' | 'en';
}

/**
 * Escapes a cell value for RFC 4180 CSV standard compliance.
 * Wraps values in quotes and escapes internal double-quotes by doubling them.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  // Quoting alone does not stop spreadsheet formula evaluation: a leading
  // = + - @ or tab still runs as a formula, so neutralize it with a quote.
  const safe = /^[=+\-@\t]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Generates an institutional attendance report in CSV format with UTF-8 BOM
 * for direct compatibility with Microsoft Excel on Windows.
 */
export function generateAttendanceCsv(options: AttendanceCsvOptions): string {
  const {
    sectionNumber,
    courseCode = '',
    courseName = '',
    date,
    lecturerName = '',
    semesterName = '',
    metrics,
    students,
    locale = 'vi',
  } = options;

  const attendanceCsvMessages = getMessages(locale).teachingPages.attendanceCsv;
  const statusMessages = attendanceCsvMessages.statuses;

  const rows: string[] = [];

  // 1. Institutional header
  rows.push(
    escapeCsvField(
      attendanceCsvMessages.institution,
    ),
  );
  rows.push(
    escapeCsvField(
      attendanceCsvMessages.reportTitle,
    ),
  );
  rows.push('');

  // 2. Metadata block
  const fullCourse = [courseCode, courseName].filter(Boolean).join(' - ');
  rows.push(
    [
      escapeCsvField(attendanceCsvMessages.metadata.section),
      escapeCsvField(sectionNumber),
      escapeCsvField(attendanceCsvMessages.metadata.course),
      escapeCsvField(fullCourse),
    ].join(','),
  );

  rows.push(
    [
      escapeCsvField(attendanceCsvMessages.metadata.date),
      escapeCsvField(date),
      escapeCsvField(attendanceCsvMessages.metadata.semester),
      escapeCsvField(semesterName || attendanceCsvMessages.metadata.currentTerm),
    ].join(','),
  );

  if (lecturerName) {
    rows.push(
      [
        escapeCsvField(attendanceCsvMessages.metadata.instructor),
        escapeCsvField(lecturerName),
      ].join(','),
    );
  }

  // 3. Statistics summary block
  rows.push(
    [
      escapeCsvField(attendanceCsvMessages.statistics.total),
      escapeCsvField(metrics.total),
      escapeCsvField(attendanceCsvMessages.statistics.present),
      escapeCsvField(metrics.present),
      escapeCsvField(attendanceCsvMessages.statistics.absent),
      escapeCsvField(metrics.absent),
      escapeCsvField(attendanceCsvMessages.statistics.late),
      escapeCsvField(metrics.late),
      escapeCsvField(attendanceCsvMessages.statistics.excused),
      escapeCsvField(metrics.excused),
      escapeCsvField(attendanceCsvMessages.statistics.rate),
      escapeCsvField(`${metrics.rate.toFixed(1)}%`),
    ].join(','),
  );
  rows.push('');

  // 4. Student Roster Table Header
  rows.push(
    [
      ...attendanceCsvMessages.rosterHeaders.map(escapeCsvField),
    ].join(','),
  );

  // 5. Student Roster Rows
  students.forEach((student, index) => {
    const statusText = student.status
      ? statusMessages[student.status] || student.status
      : statusMessages.UNMARKED;
    rows.push(
      [
        escapeCsvField(index + 1),
        escapeCsvField(student.studentCode || student.studentId),
        escapeCsvField(student.studentName),
        escapeCsvField(statusText),
        escapeCsvField(student.notes || ''),
      ].join(','),
    );
  });

  // Prepend UTF-8 BOM (\uFEFF) for Excel on Windows to read Vietnamese characters accurately
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}

/**
 * Triggers a browser download of a CSV file.
 */
export function downloadCsvFile(filename: string, csvContent: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
