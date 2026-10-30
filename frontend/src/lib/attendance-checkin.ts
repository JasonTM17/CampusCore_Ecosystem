/**
 * Geofenced attendance check-in — pure web helpers shared by the lecturer
 * panel, the admin geofence console and the public landing page. Everything
 * here is DOM-free so the node:test contract suite can exercise it directly.
 *
 * Security contract (spec §3/§7): the rotating code is only ever fetched from
 * GET /attendance/sessions/{id}/code and rendered on screen — these helpers
 * therefore never accept a code as input, so a share/deep link cannot carry
 * one by construction.
 */

export const CHECKIN_WINDOW_PRESETS_MINUTES = [10, 15, 30, 45, 60] as const;
export const CHECKIN_DEFAULT_LATE_AFTER_MINUTES = 10;
export const CHECKIN_LANDING_PATH_PREFIX = '/attendance/checkin';
export const CHECKIN_APP_SCHEME = 'campuscore';
export const CAMPUS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
// Asia/Ho_Chi_Minh has no daylight saving — the +07:00 offset is fixed.
const CAMPUS_OFFSET_MINUTES = 7 * 60;

export const GEOFENCE_RADIUS_MIN_METERS = 30;
export const GEOFENCE_RADIUS_MAX_METERS = 1000;
export const GEOFENCE_LAT_MIN = -90;
export const GEOFENCE_LAT_MAX = 90;
export const GEOFENCE_LNG_MIN = -180;
export const GEOFENCE_LNG_MAX = 180;
export const GEOFENCE_NAME_MAX = 240;
export const GEOFENCE_CAMPUS_CODE_MAX = 60;
export const GEOFENCE_NOTE_MAX = 500;

// Opaque id as issued by the backend (UUID today, any safe token tomorrow):
// letter/digit start, then letters, digits, '-' or '_', 6–128 total.
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;

export function isValidAttendanceSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

/** Canonical web landing path — session id only, never the rotating code. */
export function buildCheckinLandingPath(sessionId: string): string | null {
  if (!isValidAttendanceSessionId(sessionId)) {
    return null;
  }
  return `${CHECKIN_LANDING_PATH_PREFIX}/${encodeURIComponent(sessionId)}`;
}

/**
 * Absolute https share link for the lecturer to post. `landingPath` is the
 * (possibly locale-prefixed) path from buildCheckinLandingPath; the origin is
 * supplied by the caller so the function stays testable.
 */
export function buildCheckinShareUrl(origin: string, landingPath: string): string | null {
  const base = typeof origin === 'string' ? origin.replace(/\/+$/, '') : '';
  if (!base || !/^https?:\/\//i.test(base) || /[\s?#]/.test(landingPath)) {
    return null;
  }
  if (!landingPath.startsWith('/')) {
    return null;
  }
  return `${base}${landingPath}`;
}

/** Deep link the CampusUTE app registers for — opens the check-in screen. */
export function buildCheckinDeepLink(sessionId: string): string | null {
  if (!isValidAttendanceSessionId(sessionId)) {
    return null;
  }
  return `${CHECKIN_APP_SCHEME}://attendance/checkin/${encodeURIComponent(sessionId)}`;
}

/**
 * External OpenStreetMap helper for the admin console. The site CSP is
 * `frame-src 'self' blob:`, so an embedded OSM iframe is deliberately NOT an
 * option — this is a plain external link only.
 */
export function buildOsmMarkerUrl(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (lat < GEOFENCE_LAT_MIN || lat > GEOFENCE_LAT_MAX) {
    return null;
  }
  if (lng < GEOFENCE_LNG_MIN || lng > GEOFENCE_LNG_MAX) {
    return null;
  }
  const latText = lat.toFixed(6);
  const lngText = lng.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${latText}&mlon=${lngText}#map=17/${latText}/${lngText}`;
}

/** Today's date (YYYY-MM-DD) on the campus calendar, not the browser's. */
export function campusTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAMPUS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * Convert a campus-local date + HH:mm into an instant the backend accepts.
 * AttendanceSession stores timestamptz and validates
 * opensAt.atZone(Asia/Ho_Chi_Minh).toLocalDate() === date.
 */
export function campusLocalTimeToUtcIso(date: string, hhmm: string): string | null {
  if (!isValidIsoDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) {
    return null;
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - CAMPUS_OFFSET_MINUTES * 60_000;
  const instant = new Date(utcMs);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

export function addMinutesToIso(iso: string, minutes: number): string | null {
  const base = new Date(iso).getTime();
  if (!Number.isFinite(minutes) || Number.isNaN(base)) {
    return null;
  }
  return new Date(base + minutes * 60_000).toISOString();
}

export type SessionWindowDraft = {
  /** Campus calendar date picked on the attendance sheet (YYYY-MM-DD). */
  date: string;
  /** Minutes the window stays open — one of CHECKIN_WINDOW_PRESETS_MINUTES. */
  durationMinutes: number;
  lateAfterMinutes: number;
  /** Campus-local HH:mm — only meaningful for a future campus date. */
  startTime?: string;
};

export type SessionWindowPlan = {
  opensAtIso?: string;
  closesAtIso: string;
  errors: {
    date?: 'past' | 'invalid';
    startTime?: 'required' | 'invalid';
    lateAfter?: 'invalid';
    duration?: 'invalid';
  };
};

/**
 * Resolves the opensAt/closesAt pair for POST /attendance/sessions. For the
 * current campus day the server defaults opensAt to now (so opensAtIso is
 * left undefined); for a future campus day an explicit campus-local start
 * time is required. Validation mirrors SessionService.open().
 */
export function planSessionWindow(
  draft: SessionWindowDraft,
  now: Date = new Date(),
): SessionWindowPlan {
  const errors: SessionWindowPlan['errors'] = {};
  const campusToday = campusTodayIso(now);

  if (!isValidIsoDate(draft.date)) {
    errors.date = 'invalid';
  } else if (draft.date < campusToday) {
    errors.date = 'past';
  }

  const durationValid =
    Number.isInteger(draft.durationMinutes)
    && draft.durationMinutes > 0
    && draft.durationMinutes <= 60;
  if (!durationValid) {
    errors.duration = 'invalid';
  }

  const lateValid =
    Number.isInteger(draft.lateAfterMinutes)
    && draft.lateAfterMinutes >= 0
    && draft.lateAfterMinutes <= 60
    && durationValid
    && draft.lateAfterMinutes <= draft.durationMinutes;
  if (!lateValid) {
    errors.lateAfter = 'invalid';
  }

  let opensAtIso: string | undefined;
  let closesAtIso: string | undefined;
  if (!errors.date && durationValid) {
    if (draft.date === campusToday) {
      opensAtIso = undefined;
      closesAtIso = addMinutesToIso(now.toISOString(), draft.durationMinutes) ?? undefined;
    } else {
      const startTime = draft.startTime?.trim() ?? '';
      if (!startTime) {
        errors.startTime = 'required';
      } else {
        const resolved = campusLocalTimeToUtcIso(draft.date, startTime);
        if (!resolved) {
          errors.startTime = 'invalid';
        } else {
          opensAtIso = resolved;
          closesAtIso = addMinutesToIso(resolved, draft.durationMinutes) ?? undefined;
        }
      }
    }
  }

  if (!closesAtIso) {
    errors.date = errors.date ?? 'invalid';
    closesAtIso = now.toISOString();
  }

  return { opensAtIso, closesAtIso, errors };
}

const CODE_REFRESH_SKEW_MS = 250;
const CODE_REFRESH_RETRY_MS = 1_000;
const CODE_DEFAULT_STEP_SECONDS = 30;

/**
 * How long to wait before re-fetching the rotating code. The server's
 * expiresAt is authoritative; when it is missing the step length is the
 * fallback. A boundary already passed (clock skew or a rotated fetch) asks
 * for a short retry instead of a busy loop.
 */
export function nextCodeRefreshMs(
  code: { expiresAt?: string; stepSeconds?: number } | null | undefined,
  nowMs: number,
): number {
  const stepMs = Math.max(
    1_000,
    (code?.stepSeconds && Number.isFinite(code.stepSeconds)
      ? code.stepSeconds
      : CODE_DEFAULT_STEP_SECONDS) * 1_000,
  );
  const expiresMs = code?.expiresAt ? new Date(code.expiresAt).getTime() : Number.NaN;
  if (Number.isNaN(expiresMs)) {
    return stepMs;
  }
  return Math.max(expiresMs - nowMs + CODE_REFRESH_SKEW_MS, CODE_REFRESH_RETRY_MS);
}

/** Whole seconds until the session window closes — for the countdown chip. */
export function sessionSecondsLeft(closesAt: string | undefined, nowMs: number): number | null {
  if (!closesAt) return null;
  const closesMs = new Date(closesAt).getTime();
  if (Number.isNaN(closesMs)) return null;
  return Math.max(0, Math.ceil((closesMs - nowMs) / 1_000));
}

export function shouldPollSession(
  visibilityState: string,
  sessionStatus: string | undefined,
): boolean {
  return visibilityState === 'visible' && sessionStatus === 'OPEN';
}

/** Check-in reasons arrive comma-joined; chips split them back apart. */
export function splitCheckinReasons(reason: string | null | undefined): string[] {
  return (reason ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

// Reasons emitted by RiskEvaluator/GeofenceVerifier (backend). Anything else
// renders the raw token — same convention as the attendance status badges.
export const CHECKIN_REASON_TOKENS = [
  'INSIDE',
  'BORDERLINE',
  'LOW_ACCURACY',
  'OUTSIDE_AREA',
  'INVALID_LOCATION',
  'BAD_CODE',
  'SHARED_DEVICE',
  'MOCK_PROVIDER',
  'ZERO_ACCURACY',
  'IDENTICAL_COORDINATES',
  'IMPOSSIBLE_SPEED',
  'CONSENT_REQUIRED',
  'ALREADY_CHECKED_IN',
  'SESSION_CLOSED',
  'TOO_MANY_ATTEMPTS',
] as const;

export type CheckinReasonToken = (typeof CHECKIN_REASON_TOKENS)[number];

export const CHECKIN_DECISION_TOKENS = [
  'ACCEPTED',
  'PENDING_REVIEW',
  'REJECTED',
] as const;

/**
 * The migration ships one seeded campus row with an explicit UNVERIFIED/
 * APPROXIMATE marker and isActive=false. The console must warn on it (and any
 * row carrying the same markers) before an admin turns it on.
 */
export function isUnverifiedGeofence(row: {
  name?: string;
  note?: string;
  isActive?: boolean;
}): boolean {
  const marker = `${row.name ?? ''} ${row.note ?? ''}`.toUpperCase();
  return marker.includes('UNVERIFIED') || marker.includes('APPROXIMATE');
}

export type GeofenceDraft = {
  name: string;
  campusCode: string;
  centerLat: string;
  centerLng: string;
  radiusMeters: string;
  isActive: boolean;
  note: string;
};

export type GeofenceFormErrors = Partial<
  Record<'name' | 'campusCode' | 'centerLat' | 'centerLng' | 'radiusMeters' | 'note', 'required' | 'invalid' | 'range' | 'tooLong'>
>;

export type ParsedGeofenceValues = {
  name: string;
  campusCode: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  isActive: boolean;
  note?: string;
};

function parseCoordinate(value: string): number | null {
  const trimmed = value.trim();
  // Decimal input only: no thousand separators, no comma decimal marks.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Field-level validation shared by create and edit in the admin console. */
export function validateGeofenceDraft(draft: GeofenceDraft): {
  errors: GeofenceFormErrors;
  values: ParsedGeofenceValues | null;
} {
  const errors: GeofenceFormErrors = {};
  const name = draft.name.trim();
  const campusCode = draft.campusCode.trim();
  const note = draft.note.trim();

  if (!name) {
    errors.name = 'required';
  } else if (name.length > GEOFENCE_NAME_MAX) {
    errors.name = 'tooLong';
  }
  if (!campusCode) {
    errors.campusCode = 'required';
  } else if (campusCode.length > GEOFENCE_CAMPUS_CODE_MAX) {
    errors.campusCode = 'tooLong';
  }
  if (note.length > GEOFENCE_NOTE_MAX) {
    errors.note = 'tooLong';
  }

  const lat = parseCoordinate(draft.centerLat);
  if (lat === null) {
    errors.centerLat = draft.centerLat.trim() ? 'invalid' : 'required';
  } else if (lat < GEOFENCE_LAT_MIN || lat > GEOFENCE_LAT_MAX) {
    errors.centerLat = 'range';
  }

  const lng = parseCoordinate(draft.centerLng);
  if (lng === null) {
    errors.centerLng = draft.centerLng.trim() ? 'invalid' : 'required';
  } else if (lng < GEOFENCE_LNG_MIN || lng > GEOFENCE_LNG_MAX) {
    errors.centerLng = 'range';
  }

  const radiusText = draft.radiusMeters.trim();
  const radius = /^-?\d+$/.test(radiusText) ? Number(radiusText) : null;
  if (radius === null) {
    errors.radiusMeters = radiusText ? 'invalid' : 'required';
  } else if (radius < GEOFENCE_RADIUS_MIN_METERS || radius > GEOFENCE_RADIUS_MAX_METERS) {
    errors.radiusMeters = 'range';
  }

  const hasErrors = Object.keys(errors).length > 0;
  return {
    errors,
    values:
      hasErrors || lat === null || lng === null || radius === null
        ? null
        : {
          name,
          campusCode,
          centerLat: lat,
          centerLng: lng,
          radiusMeters: radius,
          isActive: Boolean(draft.isActive),
          ...(note ? { note } : {}),
        },
  };
}
