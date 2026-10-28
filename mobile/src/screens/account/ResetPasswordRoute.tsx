import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { useMobileNavigation } from '../../navigation/router-adapter';
import { ResetPasswordScreen } from './ResetPasswordScreen';
import { extractResetToken } from './recovery-flow';

/**
 * Route entry for `reset-password?token=...`. It snapshots the token once and
 * then removes it from the router params so it does not linger in navigation
 * state or restored history.
 */
export default function ResetPasswordRoute() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const router = useRouter();
  const navigation = useMobileNavigation();
  const [token] = useState(() => extractResetToken(params.token));

  useEffect(() => {
    if (params.token !== undefined) {
      router.setParams({ token: undefined });
    }
  }, [params.token, router]);

  return (
    <ResetPasswordScreen
      initialToken={token}
      navigation={navigation}
      role="student"
      selectedThesisTopicId={null}
    />
  );
}
