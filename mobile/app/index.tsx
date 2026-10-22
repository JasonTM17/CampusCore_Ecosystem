import { Redirect } from 'expo-router';

import { roleHomePath } from '../src/navigation/route-map';
import { useSession } from '../src/session/SessionContext';

/** Entry redirect: session decides sign-in vs role home — no landing screen. */
export default function Index() {
  const session = useSession();
  return (
    <Redirect
      href={session.kind === 'signedOut' ? '/sign-in' : roleHomePath(session.role)}
    />
  );
}
