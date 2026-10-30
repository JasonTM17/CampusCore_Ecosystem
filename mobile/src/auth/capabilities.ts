import type { LaneFlags } from '../config/lane-flags';
import type { UserRole } from '../navigation/routes';

/**
 * Pure capability resolution (no expo/react-native imports). The UI role is a
 * surface selector chosen by `roleFromClaims`; capabilities are the separate,
 * additive grants that unlock the flag-gated lanes. Everything here fails
 * closed: a missing flag, claim or server grant yields no capability.
 */

export type StaffDesk = 'applyReview' | 'careersDesk' | 'libraryDesk';

/**
 * Access-token `capabilities` claim value minted by both token issuers for
 * every grant-eligible (ACTIVE) account. It names the SELF admissions
 * surface only — it is never derived from a username, a demo id, an
 * application row, or any academic role, and it confers no academic right.
 */
export const ADMISSIONS_SELF_CLAIM = 'admissions:self';

/**
 * UI surface selector a roleless applicant session renders under. It is a
 * presentation placeholder only: the `applicant.surface` capability — not
 * this selector — decides which screens stay reachable, and the server
 * still sees a token with no academic roles.
 */
export const APPLICANT_UI_ROLE: UserRole = 'student';

export type Capability =
  | 'dean.overview'
  | 'admin.oversight'
  | 'staff.applyReview'
  | 'staff.careersDesk'
  | 'staff.libraryDesk'
  | 'student.checkin'
  | 'admissions.self'
  | 'applicant.surface';

export type CapabilitySet = readonly Capability[];

export const NO_CAPABILITIES: CapabilitySet = Object.freeze([]);

/**
 * Staff desks are granted per desk by the server (a separate grant surface),
 * never inferred from the admin role. Until that surface is wired the set is
 * empty.
 */
export interface StaffGrants {
  readonly desks: readonly StaffDesk[];
}

export const NO_STAFF_GRANTS: StaffGrants = Object.freeze({ desks: Object.freeze([]) });

const STAFF_DESKS: readonly StaffDesk[] = ['applyReview', 'careersDesk', 'libraryDesk'];

/**
 * Server grant response → grants. Only a 200 carrying known desk names counts;
 * 401/403/5xx or any other shape is denied, and unknown names are dropped.
 */
export function staffGrantsFromResponse(status: number, body: unknown): StaffGrants {
  if (status !== 200 || !body || typeof body !== 'object') {
    return NO_STAFF_GRANTS;
  }
  const desks = (body as { desks?: unknown }).desks;
  if (!Array.isArray(desks)) {
    return NO_STAFF_GRANTS;
  }
  const granted = STAFF_DESKS.filter((desk) => desks.includes(desk));
  return granted.length > 0 ? { desks: granted } : NO_STAFF_GRANTS;
}

const normalizeClaims = (claims: readonly string[]) =>
  new Set(claims.map((claim) => claim.toUpperCase()));

/**
 * Dean = the faculty head claim only. The department-head claim
 * (`TRUONG_BO_MON`) never grants it: such an account follows the normal claim
 * precedence (lecturer lane with a lecturer claim, otherwise sign-in blocked).
 */
export function hasDeanClaim(claims: readonly string[]): boolean {
  return normalizeClaims(claims).has('TRUONG_KHOA');
}

export interface CapabilityInput {
  claims: readonly string[];
  lanes: LaneFlags;
  staffGrants?: StaffGrants | null;
  /**
   * Issuer-minted `capabilities` claim values on the access token (see
   * `capabilityClaimsFromPayload`). Unknown values are dropped.
   */
  capabilityClaims?: readonly string[];
  /**
   * UI role the account resolved to, or null for a roleless authenticated
   * account. Only a roleless account carrying `admissions:self` earns the
   * `applicant.surface` marker — an account with a real role keeps its
   * existing behavior.
   */
  role?: UserRole | null;
}

export function resolveCapabilities(input: CapabilityInput): CapabilitySet {
  const claims = normalizeClaims(input.claims);
  const granted: Capability[] = [];
  const issued = new Set(input.capabilityClaims ?? []);
  if (issued.has(ADMISSIONS_SELF_CLAIM)) {
    granted.push('admissions.self');
    if (input.role == null) {
      // Roleless account with the grant: applicant-only surface. The marker
      // is what lets the route guard tell this session apart from a real
      // student session that merely shares the same UI selector.
      granted.push('applicant.surface');
    }
  }
  if (input.lanes.dean && claims.has('TRUONG_KHOA')) {
    granted.push('dean.overview');
  }
  if (input.lanes.admin && (claims.has('ADMIN') || claims.has('SUPER_ADMIN'))) {
    granted.push('admin.oversight');
  }
  if (input.lanes.staff) {
    for (const desk of input.staffGrants?.desks ?? []) {
      if (STAFF_DESKS.includes(desk)) {
        granted.push(`staff.${desk}` as Capability);
      }
    }
  }
  // Student check-in lane (G3B): flag + STUDENT claim — every real student can
  // check in; the flag is the build-time switch for the whole surface.
  if (input.lanes.checkin && claims.has('STUDENT')) {
    granted.push('student.checkin');
  }
  return granted;
}

export function hasCapability(capabilities: CapabilitySet, capability: Capability): boolean {
  return capabilities.includes(capability);
}

/** Whether this capability set marks an applicant-only session surface. */
export function hasApplicantSurface(capabilities: CapabilitySet | undefined): boolean {
  return hasCapability(capabilities ?? NO_CAPABILITIES, 'applicant.surface');
}

/**
 * Access-token payload → issuer-minted `capabilities` claim values. Only a
 * string array counts; anything else yields no claims (fail closed).
 */
export function capabilityClaimsFromPayload(payload: Record<string, unknown> | null): readonly string[] {
  const claims = payload?.capabilities;
  return Array.isArray(claims)
    ? claims.filter((value): value is string => typeof value === 'string')
    : [];
}

/** Portal host whose HTTPS links are app-claimed (universal links). */
const PORTAL_HOST = 'www.campusute.io.vn';

/**
 * Deep-link input → app path (+ query), or null when the input is not an
 * app-owned link. Only the app scheme, a bare absolute path or an
 * `https://www.campusute.io.vn` link is accepted; foreign schemes/hosts,
 * traversal, encoded separators, backslashes, control characters and
 * empty/doubled segments are rejected before any routing.
 */
export function normalizeDeepLink(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2048) {
    return null;
  }
  if (input.includes(String.fromCharCode(92))) {
    return null;
  }
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return null;
    }
  }
  let rest = input;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(input);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name === 'campuscore') {
      rest = `/${input.slice(scheme[0].length)}`;
    } else if (name === 'https' && input.slice(scheme[0].length).toLowerCase().startsWith(`${PORTAL_HOST}/`)) {
      // Claimed universal link: strip exactly the portal host — ports,
      // userinfo, subdomains and look-alike hosts all stay refused.
      rest = input.slice(scheme[0].length + PORTAL_HOST.length);
    } else {
      return null;
    }
  }
  if (!rest.startsWith('/')) {
    return null;
  }
  const [pathPart, ...queryParts] = rest.split('?');
  const query = queryParts.join('?');
  if (query.includes('#') || pathPart.includes('#')) {
    return null;
  }
  const trimmed = pathPart.length > 1 ? pathPart.replace(/\/+$/, '') : pathPart;
  const segments = trimmed.split('/').slice(1);
  if (trimmed !== '/' && segments.some((segment) => segment.length === 0)) {
    return null;
  }
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes(String.fromCharCode(92))
    ) {
      return null;
    }
  }
  return query ? `${trimmed}?${query}` : trimmed;
}
