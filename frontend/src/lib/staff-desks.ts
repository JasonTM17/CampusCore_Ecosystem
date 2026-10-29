import api from '@/lib/api';
import { campusErrorKind } from '@/lib/campus-error';

export type StaffDeskKey = 'admissions' | 'careers' | 'library';

export interface StaffDesk {
  key: StaffDeskKey;
  /** Route of the desk surface; the destination re-checks the grant server-side. */
  href: string;
  /**
   * Caller-scoped capability read: the grants list answers 200 only while the
   * signed-in user holds that desk's staff grant, and a *-STAFF_REQUIRED 403
   * otherwise. The rows (grant metadata only) are discarded — the page needs
   * the status, not the payload.
   */
  grantsPath: string;
}

export const STAFF_DESKS: readonly StaffDesk[] = [
  { key: 'admissions', href: '/apply/review', grantsPath: '/admissions/staff/grants' },
  { key: 'careers', href: '/careers/desk', grantsPath: '/careers/staff/grants' },
  { key: 'library', href: '/library/desk', grantsPath: '/library/staff/grants' },
];

export type DeskProbeOutcome = 'granted' | 'denied' | 'failed';

/** An explicit deny (401/403) is a capability answer; anything else is not. */
export function deskOutcomeForStatus(status: number | undefined): DeskProbeOutcome {
  if (status === 200) {
    return 'granted';
  }
  if (status === 401 || status === 403) {
    return 'denied';
  }
  return 'failed';
}

/** Registry-ordered keys for every desk whose probe returned a grant. */
export function desksFromOutcomes(
  outcomes: readonly DeskProbeOutcome[],
): StaffDeskKey[] {
  return STAFF_DESKS
    .filter((_, index) => outcomes[index] === 'granted')
    .map((desk) => desk.key);
}

export interface StaffDeskAccess {
  desks: StaffDeskKey[];
  /** A probe that never got an authoritative answer must not read as "no grants". */
  probeFailed: boolean;
}

export async function probeStaffDesks(): Promise<StaffDeskAccess> {
  const outcomes = await Promise.all(
    STAFF_DESKS.map(async (desk): Promise<DeskProbeOutcome> => {
      try {
        const response = await api.get(desk.grantsPath);
        return deskOutcomeForStatus(response.status);
      } catch (cause) {
        const kind = campusErrorKind(cause);
        return kind === 'forbidden' || kind === 'unauthorized' ? 'denied' : 'failed';
      }
    }),
  );
  return {
    desks: desksFromOutcomes(outcomes),
    probeFailed: outcomes.includes('failed'),
  };
}
