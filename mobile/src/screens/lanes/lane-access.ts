// Pure lane access rule. A lane screen renders only for an authenticated
// session whose build flag for that lane group is on AND whose capability set
// grants the lane. Every input defaults to refusal, and preview is never an
// authorization substitute — except `PREVIEW_LANES` demo surfaces (the
// student check-in screen), which a flagged preview session may open because
// they render simulated data and cannot submit. The router guard
// (route-map.resolveGuard) applies the same rule on entry; this is the second
// check at render time.

import type { LaneFlags } from '../../config/lane-flags';
import type { CapabilitySet } from '../../auth/capabilities';
import {
  laneAllowedForSession,
  type LaneScreenId,
  type UserRole,
} from '../../navigation/routes';

export { laneGroupOf, type LaneGroup } from '../../navigation/routes';

export interface LaneAccessInput {
  kind: 'signedOut' | 'preview' | 'authenticated';
  role: UserRole;
  capabilities: CapabilitySet | undefined;
  flags: LaneFlags;
  id: LaneScreenId;
}

export function laneAllowed(input: LaneAccessInput): boolean {
  return laneAllowedForSession(input);
}
