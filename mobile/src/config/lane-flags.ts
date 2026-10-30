/**
 * Build-time switches for the native lanes that stay web-only until the
 * repository owner records a decision (dean overview, staff desks, admin
 * oversight). Every flag is off unless the build sets it to the exact string
 * `true`. Pure so the same logic runs in the app and under `node --test`.
 */

export interface LaneFlags {
  readonly dean: boolean;
  readonly staff: boolean;
  readonly admin: boolean;
  /** Student attendance check-in lane (G3B): native GPS check-in surface. */
  readonly checkin: boolean;
}

export type LaneFlagEnv = Readonly<Record<string, string | undefined>>;

export const LANES_OFF: LaneFlags = Object.freeze({ dean: false, staff: false, admin: false, checkin: false });

const enabled = (value: string | undefined) => value === 'true';

export function readLaneFlags(env: LaneFlagEnv): LaneFlags {
  return Object.freeze({
    dean: enabled(env.EXPO_PUBLIC_LANE_DEAN),
    staff: enabled(env.EXPO_PUBLIC_LANE_STAFF),
    admin: enabled(env.EXPO_PUBLIC_LANE_ADMIN),
    checkin: enabled(env.EXPO_PUBLIC_LANE_CHECKIN),
  });
}

// Metro only inlines `process.env.EXPO_PUBLIC_*` as a literal member access,
// so each flag is named here instead of passing `process.env` wholesale.
export const LANE_FLAGS: LaneFlags = readLaneFlags({
  EXPO_PUBLIC_LANE_DEAN: process.env.EXPO_PUBLIC_LANE_DEAN,
  EXPO_PUBLIC_LANE_STAFF: process.env.EXPO_PUBLIC_LANE_STAFF,
  EXPO_PUBLIC_LANE_ADMIN: process.env.EXPO_PUBLIC_LANE_ADMIN,
  EXPO_PUBLIC_LANE_CHECKIN: process.env.EXPO_PUBLIC_LANE_CHECKIN,
});
