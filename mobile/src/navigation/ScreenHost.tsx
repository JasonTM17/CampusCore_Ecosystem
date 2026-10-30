import { useLocalSearchParams } from 'expo-router';

import { screenComponents } from '../screens';
import { useMobileNavigation } from './router-adapter';
import type { ScreenName } from './routes';
import { useSession } from '../session/SessionContext';

/**
 * Shared route host (mobile-policy §1): every `app/(app)/*.tsx` file is a
 * one-line `ScreenRoute('<name>')` — this host injects the MobileNavigation
 * adapter, the session role, and the thesis-topic param so the 20 existing
 * screens keep their `MobileScreenProps` contract untouched.
 */
export function ScreenRoute({ name }: { name: ScreenName }) {
  const navigation = useMobileNavigation();
  const session = useSession();
  const params = useLocalSearchParams<{ topicId?: string }>();
  const Component = screenComponents[name];
  const topicId = typeof params.topicId === 'string' ? params.topicId : null;
  return (
    <Component
      navigation={navigation}
      role={session.role}
      selectedThesisTopicId={topicId}
    />
  );
}
