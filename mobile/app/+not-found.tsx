import { Redirect, usePathname } from 'expo-router';

import { pathFor, resolveGuard } from '../src/navigation/route-map';
import { useSession } from '../src/session/SessionContext';

/** Unmatched deep links funnel through the same guard as everything else. */
export default function NotFound() {
  const session = useSession();
  const pathname = usePathname() ?? '/';
  const decision = resolveGuard(session.kind, session.role, pathname, session.capabilities);
  return <Redirect href={decision.to ? pathFor(decision.to) : '/sign-in'} />;
}
