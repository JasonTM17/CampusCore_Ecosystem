// Pure locale logic shared by the provider and the UI composites. No React or
// native imports, so it runs unchanged under `node --test`.

export type AppLocale = 'vi' | 'en';

export const DEFAULT_LOCALE: AppLocale = 'vi';
export const SUPPORTED_LOCALES: readonly AppLocale[] = ['vi', 'en'];
export const LOCALE_STORAGE_KEY = 'campusute.locale';

export function normalizeLocale(value: unknown): AppLocale {
  if (typeof value !== 'string') return DEFAULT_LOCALE;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return base === 'en' ? 'en' : 'vi';
}

/* ---------- Persistence (storage is injected) ---------- */

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Reads the saved preference; any storage failure falls back to vi. */
export async function loadLocale(storage?: KeyValueStorage): Promise<AppLocale> {
  if (!storage) return DEFAULT_LOCALE;
  try {
    const raw = await storage.getItem(LOCALE_STORAGE_KEY);
    return raw === 'en' || raw === 'vi' ? raw : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Returns false when the preference could not be persisted. */
export async function saveLocale(storage: KeyValueStorage | undefined, locale: AppLocale): Promise<boolean> {
  if (!storage) return false;
  try {
    await storage.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

/* ---------- Formatting ---------- */

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const EMPTY = '—';
const CAMPUS_TIME_OFFSET_MS = 7 * 60 * 60 * 1000;
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_VI = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const MONTHS_LONG_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface DateParts { y: number; m: number; d: number; hh: number; mm: number }

/** Extracts campus-local parts from instants while keeping date-only values civil. */
function toParts(value: string | number | Date | null | undefined): DateParts | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const only = DATE_ONLY.exec(value);
    if (only) return { y: +only[1], m: +only[2], d: +only[3], hh: 0, mm: 0 };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const campusDate = new Date(date.getTime() + CAMPUS_TIME_OFFSET_MS);
  return {
    y: campusDate.getUTCFullYear(),
    m: campusDate.getUTCMonth() + 1,
    d: campusDate.getUTCDate(),
    hh: campusDate.getUTCHours(),
    mm: campusDate.getUTCMinutes(),
  };
}

function datePart(p: DateParts, locale: AppLocale): string {
  if (locale === 'vi') return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
  const month = MONTHS_EN[p.m - 1];
  return month ? `${month} ${p.d}, ${p.y}` : `${pad(p.m)}/${pad(p.d)}/${p.y}`;
}

/** Date-only strings (YYYY-MM-DD) never shift with the device time zone. */
export function formatDate(value: string | number | Date | null | undefined, locale: AppLocale): string {
  const p = toParts(value);
  return p ? datePart(p, locale) : EMPTY;
}

/** Web dashboard chip format: weekday, day month, year. */
export function formatLongDate(value: string | number | Date | null | undefined, locale: AppLocale): string {
  const p = toParts(value);
  if (!p) return EMPTY;
  const weekday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  if (locale === 'vi') {
    return `${WEEKDAYS_VI[weekday]}, ${p.d} tháng ${p.m}, ${p.y}`;
  }
  return `${WEEKDAYS_EN[weekday]}, ${MONTHS_LONG_EN[p.m - 1]} ${p.d}, ${p.y}`;
}

/** Time-only half of a date-time string, in the locale's clock convention. */
function timePart(p: DateParts, locale: AppLocale): string {
  if (locale === 'vi') return `${pad(p.hh)}:${pad(p.mm)}`;
  const hour12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  const meridiem = p.hh < 12 ? 'AM' : 'PM';
  return `${pad(hour12)}:${pad(p.mm)} ${meridiem}`;
}

/** Web date-time format: vi prints time-first 24-hour, en prints 12-hour AM/PM. */
export function formatDateTime(value: string | number | Date | null | undefined, locale: AppLocale): string {
  const p = toParts(value);
  if (!p) return EMPTY;
  const time = timePart(p, locale);
  return locale === 'vi' ? `${time} ${datePart(p, locale)}` : `${datePart(p, locale)}, ${time}`;
}

/** Day and month with the campus clock, matching the web assistant message stamp. */
export function formatDayMonthTime(value: string | number | Date | null | undefined, locale: AppLocale): string {
  const p = toParts(value);
  if (!p) return EMPTY;
  const day = locale === 'vi' ? `${pad(p.d)}/${pad(p.m)}` : `${MONTHS_EN[p.m - 1] ?? pad(p.m)} ${p.d}`;
  return `${day} ${pad(p.hh)}:${pad(p.mm)}`;
}

/** An instant's fixed UTC+07 calendar day, encoded at UTC midnight for zone-free day math. */
export function campusDate(value: Date | number = new Date()): Date {
  const instant = value instanceof Date ? value : new Date(value);
  const campus = new Date(instant.getTime() + CAMPUS_TIME_OFFSET_MS);
  // UTC midnight carrying the campus civil date, so day math reads UTC fields.
  return new Date(Date.UTC(campus.getUTCFullYear(), campus.getUTCMonth(), campus.getUTCDate()));
}

/** Backend day number of the campus calendar day: 1 = Sunday … 7 = Saturday. */
export function campusDayOfWeek(value: Date | number = new Date()): number {
  return campusDate(value).getUTCDay() + 1;
}

/** Minutes since midnight on the fixed UTC+07 campus clock. */
export function campusMinutesOfDay(value: Date | number = new Date()): number {
  const instant = value instanceof Date ? value : new Date(value);
  const campus = new Date(instant.getTime() + CAMPUS_TIME_OFFSET_MS);
  return campus.getUTCHours() * 60 + campus.getUTCMinutes();
}

/** The campus calendar day as YYYY-MM-DD, independent of the device zone. */
export function campusIsoDate(instant: Date = new Date()): string {
  const day = campusDate(instant);
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
}

export interface NumberFormatOptions {
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
}

export function formatNumber(value: number | null | undefined, locale: AppLocale, options: NumberFormatOptions = {}): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EMPTY;
  const max = options.maximumFractionDigits ?? 2;
  const min = Math.min(options.minimumFractionDigits ?? 0, max);
  const [intRaw, fracRaw = ''] = Math.abs(value).toFixed(max).split('.');
  let frac = fracRaw;
  while (frac.length > min && frac.endsWith('0')) frac = frac.slice(0, -1);
  const group = locale === 'en' ? ',' : '.';
  const decimal = locale === 'en' ? '.' : ',';
  const grouped = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const negative = value < 0 && (Number(intRaw) > 0 || /[1-9]/.test(frac));
  return `${negative ? '-' : ''}${grouped}${frac ? decimal + frac : ''}`;
}

export function formatCredits(value: number | null | undefined, locale: AppLocale): string {
  const text = formatNumber(value, locale, { maximumFractionDigits: 1 });
  if (text === EMPTY) return EMPTY;
  if (locale === 'en') return `${text} ${countForm(value ?? 0, 'credit', 'credits')}`;
  return `${text} tín chỉ`;
}

/**
 * Picks the one/other copy for a count, the same rule formatCredits applies.
 * Callers pass the pair for the active locale; Vietnamese pairs repeat the same text.
 */
export function countForm(count: number, one: string, other: string): string {
  return count === 1 ? one : other;
}

export function formatBytes(bytes: number | null | undefined, locale: AppLocale): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return EMPTY;
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || size >= 10 ? 0 : 1;
  return `${formatNumber(size, locale, { maximumFractionDigits: digits })} ${units[unit]}`;
}

/**
 * Parses typed date input to YYYY-MM-DD, or null when it is not a real date.
 * Accepts ISO, the locale order (vi: day first, en: month first), and the
 * English month-name form the formatter produces.
 */
export function parseDateInput(text: string, locale: AppLocale): string | null {
  const raw = text.trim();
  let y: number; let m: number; let d: number;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
  const local = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(raw);
  const monthName = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw);
  if (iso) {
    [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  } else if (local) {
    [y, m, d] = locale === 'en' ? [+local[3], +local[1], +local[2]] : [+local[3], +local[2], +local[1]];
  } else if (monthName && locale === 'en') {
    const month = MONTHS_EN.findIndex((name) => name.toLowerCase() === monthName[1].slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return null;
    [y, m, d] = [+monthName[3], month, +monthName[2]];
  } else {
    return null;
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/* ---------- Shared UI strings ---------- */

const vi = {
  retry: 'Thử lại',
  loading: 'Đang tải…',
  loadMore: 'Tải thêm',
  loadingMore: 'Đang tải thêm…',
  empty: 'Không có dữ liệu',
  errorGeneric: 'Không thể hoàn tất thao tác. Vui lòng thử lại.',
  sectionErrorTitle: 'Không hiển thị được phần này',
  sectionErrorDescription: 'Một lỗi không mong muốn đã làm gián đoạn phần này của trang. Hãy thử tải lại mà không rời khỏi không gian làm việc.',
  denied: 'Bạn không có quyền thực hiện thao tác này.',
  offline: 'CampusUTE hiện không kết nối được cổng thông tin. Vui lòng thử lại sau ít phút.',
  offlineReadWarning: 'Bạn đang ngoại tuyến — hiển thị nội dung đã đồng bộ lần cuối.',
  sessionExpired: 'Lần đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  close: 'Đóng',
  closeSheet: 'Đóng bảng',
  closeDialog: 'Đóng hộp thoại',
  cancel: 'Hủy',
  apply: 'Áp dụng',
  clear: 'Xóa',
  filters: 'Bộ lọc',
  select: 'Chọn',
  notSelected: 'Chưa chọn',
  required: 'bắt buộc',
  search: 'Tìm kiếm',
  clearSearch: 'Xóa tìm kiếm',
  selectDate: 'Chọn ngày',
  dateFormatHint: 'Nhập ngày dạng dd/mm/yyyy',
  dateInvalid: 'Ngày không hợp lệ',
  dateRequired: 'Vui lòng nhập ngày',
  dateTooEarly: 'Ngày phải từ {date} trở đi',
  dateTooLate: 'Ngày không được muộn hơn {date}',
  fileUnavailable: 'Chưa hỗ trợ trên bản này',
  fileReady: 'Sẵn sàng',
  fileBusy: 'Đang xử lý',
  fileFailed: 'Thất bại',
  chartNoData: 'Chưa có số liệu',
  chartRange: 'thấp nhất {min}, cao nhất {max}, mới nhất {last}',
  progress: 'Tiến độ',
  language: 'Ngôn ngữ',
  avatarLabel: 'Ảnh của {name}',
  avatarLabelRole: 'Ảnh của {name}, {role}',
  avatarLabelGeneric: 'Ảnh đại diện',
} as const;

export type UiMessageKey = keyof typeof vi;

const en: Record<UiMessageKey, string> = {
  retry: 'Try again',
  loading: 'Loading…',
  loadMore: 'Load more',
  loadingMore: 'Loading more…',
  empty: 'No data found',
  errorGeneric: 'We could not complete that action. Please try again.',
  sectionErrorTitle: 'This section could not be displayed',
  sectionErrorDescription: 'An unexpected error interrupted this part of the page. Retry to load it again without leaving the workspace.',
  denied: 'You do not have access to this action.',
  offline: 'CampusUTE could not reach the campus portal right now. Try again in a moment.',
  offlineReadWarning: 'You are offline — showing the last synced content.',
  sessionExpired: 'Your session has expired. Please sign in again.',
  close: 'Close',
  closeSheet: 'Close sheet',
  closeDialog: 'Close modal',
  cancel: 'Cancel',
  apply: 'Apply',
  clear: 'Clear',
  filters: 'Filters',
  select: 'Select',
  notSelected: 'Not selected',
  required: 'required',
  search: 'Search',
  clearSearch: 'Clear search',
  selectDate: 'Select date',
  dateFormatHint: 'Enter the date as mm/dd/yyyy',
  dateInvalid: 'Invalid date',
  dateRequired: 'Enter a date',
  dateTooEarly: 'Date must be {date} or later',
  dateTooLate: 'Date must be no later than {date}',
  fileUnavailable: 'Not available in this build',
  fileReady: 'Ready',
  fileBusy: 'In progress',
  fileFailed: 'Failed',
  chartNoData: 'No data yet',
  chartRange: 'lowest {min}, highest {max}, latest {last}',
  progress: 'Progress',
  language: 'Language',
  avatarLabel: 'Photo of {name}',
  avatarLabelRole: 'Photo of {name}, {role}',
  avatarLabelGeneric: 'Profile photo',
};

export const uiMessages: Record<AppLocale, Record<UiMessageKey, string>> = { vi, en };

export function translate(locale: AppLocale, key: UiMessageKey, params?: Record<string, string | number>): string {
  const template = uiMessages[locale][key] ?? uiMessages[DEFAULT_LOCALE][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
