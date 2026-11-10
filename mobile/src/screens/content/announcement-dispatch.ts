import type { MobilePublicAnnouncement } from '../../api/client';
import type { RecordsLocale } from '../../i18n/records-messages';
import { publisherName } from './content-rules';

export function dispatchReference(item: MobilePublicAnnouncement): string {
  const docHash = Math.abs(
    (item.id || 'notice')
      .split('')
      .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 100),
  ) % 900 + 100;
  const publisher = (item.publishedBy || '').toLowerCase();
  const isRectorDoc = publisher.includes('ban giám hiệu')
    || publisher.includes('hiệu trưởng')
    || (item.title || '').toLowerCase().startsWith('quyết định');
  const isFacultyDoc = publisher.includes('khoa');
  const suffix = isRectorDoc ? 'TB-ĐHCNKT' : isFacultyDoc ? 'TB-CNTT' : 'TB-ĐHCNKT-ĐT';
  return `${docHash}/${suffix}`;
}

type AudienceType = 'GLOBAL' | 'STUDENT' | 'LECTURER' | 'OTHER';

function announcementAudience(item: Pick<MobilePublicAnnouncement, 'isGlobal' | 'targetRoles'>): AudienceType {
  if (item.isGlobal) return 'GLOBAL';
  const roles = (item.targetRoles ?? []).map((role) => role.trim().toUpperCase());
  const hasStudent = roles.includes('STUDENT');
  const hasLecturer = roles.includes('LECTURER');
  if (hasStudent && hasLecturer) return 'GLOBAL';
  if (hasLecturer && !hasStudent) return 'LECTURER';
  if (hasStudent && !hasLecturer) return 'STUDENT';
  return 'OTHER';
}

export function dispatchAudienceBadge(
  item: Pick<MobilePublicAnnouncement, 'isGlobal' | 'targetRoles'>,
  labels: Readonly<Record<string, string>>,
) {
  const type = announcementAudience(item);
  const label = labels[type] ?? labels.OTHER ?? type;
  const tone = type === 'GLOBAL' ? 'info' as const : type === 'OTHER' ? 'neutral' as const : 'primary' as const;
  return { label, tone };
}

export function dispatchSalutationTarget(
  item: Pick<MobilePublicAnnouncement, 'isGlobal' | 'targetRoles'>,
  salutation: Readonly<Record<'global' | 'student' | 'lecturer', string>>,
): string {
  switch (announcementAudience(item)) {
    case 'STUDENT':
      return salutation.student;
    case 'LECTURER':
      return salutation.lecturer;
    default:
      return salutation.global;
  }
}

export function dispatchSubjectHeading(title: string): string {
  if (title.toUpperCase().startsWith('THÔNG BÁO')) {
    return title.replace(/^THÔNG BÁO\s*[:-]?\s*/i, 'V/v ');
  }
  return `V/v ${title}`;
}

export function dispatchProseDate(locale: RecordsLocale, date: Date): string {
  if (locale !== 'vi') return '';
  const proseDay = new Intl.DateTimeFormat('vi-VN', { day: 'numeric' }).format(date);
  const proseMonthRaw = new Intl.DateTimeFormat('vi-VN', { month: 'long' }).format(date);
  const proseMonth = proseMonthRaw.charAt(0).toLowerCase() + proseMonthRaw.slice(1);
  const proseYear = new Intl.DateTimeFormat('vi-VN', { year: 'numeric' }).format(date);
  return `${proseDay} ${proseMonth} năm ${proseYear}`;
}

export function dispatchPublisherLabel(
  item: MobilePublicAnnouncement,
  departmentFallback: string,
): string {
  return publisherName(item.lecturerDisplayName, item.publishedBy) ?? departmentFallback;
}

export function dispatchSemesterLabel(
  item: MobilePublicAnnouncement,
  locale: RecordsLocale,
  prefix: string,
): string | null {
  const raw = item.semesterName?.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const lowerPrefix = prefix.toLowerCase();
  if (lower.startsWith(lowerPrefix)) return raw;
  return `${prefix}: ${raw}`;
}
