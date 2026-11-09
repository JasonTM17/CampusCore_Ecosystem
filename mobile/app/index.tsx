import { Redirect } from 'expo-router';

import { useMobileNavigation } from '../src/navigation/router-adapter';
import { roleHomePath } from '../src/navigation/route-map';
import { GuestHomeScreen } from '../src/screens/guest/GuestHomeScreen';
import { useSession } from '../src/session/SessionContext';

/** Entry route: guests read the campus landing, a session keeps its role home. */
export default function Index() {
  const session = useSession();
  const navigation = useMobileNavigation();
  if (session.kind === 'signedOut' && !session.signingOut) {
    return <GuestHomeScreen navigation={navigation} role={session.role} selectedThesisTopicId={null} />;
  }
  return (
    <Redirect
      href={session.kind === 'signedOut' ? '/sign-in' : roleHomePath(session.role, session.capabilities)}
    />
  );
}
