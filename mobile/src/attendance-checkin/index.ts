export * from './attendance-api';
export * from './checkin-link';
export * from './checkin-machine';
export * from './installation-id';
export * from './location-service';

import { createNativeAttendanceApi } from './attendance-api';
import { createCheckinMachine, type CheckinMachine } from './checkin-machine';
import { getInstallationId } from './installation-id';
import { createExpoLocationProvider } from './location-service';

/** UI must reset on blur/unmount; the epoch also guards account/grant changes. */
export function createNativeCheckinMachine(): CheckinMachine {
  const { sessionStore } = require('../auth/mobile-session-store') as typeof import('../auth/mobile-session-store');
  return createCheckinMachine({ api: createNativeAttendanceApi(), location: createExpoLocationProvider(),
    getInstallationId, identity: () => sessionStore.sessionEpoch() });
}
