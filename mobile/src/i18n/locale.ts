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

interface DateParts { y: number; m: number; d: number; hh: number; mm: number }

function toParts(value: string | number | Date | null | undefined): DateParts | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const only = DATE_ONLY.exec(value);
    if (only) return { y: +only[1], m: +only[2], d: +only[3], hh: 0, mm: 0 };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), hh: date.getHours(), mm: date.getMinutes() };
}

function datePart(p: DateParts, locale: AppLocale): string {
  return locale === 'en' ? `${pad(p.m)}/${pad(p.d)}/${p.y}` : `${pad(p.d)}/${pad(p.m)}/${p.y}`;
}

/** Date-only strings (YYYY-MM-DD) never shift with the device time zone. */
export function formatDate(value: string | number | Date | null | undefined, locale: AppLocale): string {
  const p = toParts(value);
  return p ? datePart(p, locale) : EMPTY;
}

export function formatDateTime(value: string | number | Date | null | undefined, locale: AppLocale): string {
  const p = toParts(value);
  return p ? `${datePart(p, locale)} ${pad(p.hh)}:${pad(p.mm)}` : EMPTY;
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
  if (locale === 'en') return `${text} ${value === 1 ? 'credit' : 'credits'}`;
  return `${text} tín chỉ`;
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
 * Accepts ISO plus the locale order (vi: day first, en: month first).
 */
export function parseDateInput(text: string, locale: AppLocale): string | null {
  const raw = text.trim();
  let y: number; let m: number; let d: number;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
  const local = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(raw);
  if (iso) {
    [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  } else if (local) {
    [y, m, d] = locale === 'en' ? [+local[3], +local[1], +local[2]] : [+local[3], +local[2], +local[1]];
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
  empty: 'Chưa có dữ liệu',
  errorGeneric: 'Không thể tải dữ liệu',
  close: 'Đóng',
  cancel: 'Hủy',
  apply: 'Áp dụng',
  clear: 'Xóa',
  filters: 'Bộ lọc',
  select: 'Chọn',
  notSelected: 'Chưa chọn',
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
  language: 'Ngôn ngữ',
} as const;

export type UiMessageKey = keyof typeof vi;

const en: Record<UiMessageKey, string> = {
  retry: 'Try again',
  loading: 'Loading…',
  loadMore: 'Load more',
  loadingMore: 'Loading more…',
  empty: 'Nothing here yet',
  errorGeneric: 'Could not load data',
  close: 'Close',
  cancel: 'Cancel',
  apply: 'Apply',
  clear: 'Clear',
  filters: 'Filters',
  select: 'Select',
  notSelected: 'Not selected',
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
  language: 'Language',
};

export const uiMessages: Record<AppLocale, Record<UiMessageKey, string>> = { vi, en };

export function translate(locale: AppLocale, key: UiMessageKey, params?: Record<string, string | number>): string {
  const template = uiMessages[locale][key] ?? uiMessages[DEFAULT_LOCALE][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
