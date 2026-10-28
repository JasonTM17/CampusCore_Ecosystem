// Pure lane access rule. A lane screen renders only for an authenticated
// session whose build flag for that lane group is on AND whose capability set
// grants the lane. Every input defaults to refusal, and preview is never an
// authorization substitute. The router guard (route-map.resolveGuard) applies
// the same rule on entry; this is the second check at render time.

import type { LaneFlags } from '../../config/lane-flags';
import type { CapabilitySet } from '../../auth/capabilities';
import { canAccessLaneScreen, type LaneScreenId, type UserRole } from '../../navigation/routes';

export type LaneGroup = 'dean' | 'staff' | 'admin';

export const laneGroupOf = (id: LaneScreenId): LaneGroup =>
  id.startsWith('dean.') ? 'dean' : id.startsWith('staff.') ? 'staff' : 'admin';

export interface LaneAccessInput {
  kind: 'signedOut' | 'preview' | 'authenticated';
  role: UserRole;
  capabilities: CapabilitySet | undefined;
  flags: LaneFlags;
  id: LaneScreenId;
}

export function laneAllowed({ kind, role, capabilities, flags, id }: LaneAccessInput): boolean {
  if (kind !== 'authenticated' || !capabilities) return false;
  if (flags[laneGroupOf(id)] !== true) return false;
  return canAccessLaneScreen(role, capabilities, id);
}
