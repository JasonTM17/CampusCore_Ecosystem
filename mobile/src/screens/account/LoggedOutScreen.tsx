import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import type { MobileScreenProps } from '../../navigation/types';
import { AccountFrame } from './AccountFrame';
import { takeExitNotice } from './exit-notice';
import { useAccountCopy } from './use-account-copy';

/** Destination after the session ended; the wipe already ran in the session layer. */
export function LoggedOutScreen({ navigation }: MobileScreenProps) {
  const copy = useAccountCopy();
  const [notice] = useState(takeExitNotice);

  return (
    <AccountFrame title={copy.loggedOut.title}>
      <UiText
        accessibilityLiveRegion="polite"
        variant="bodyMedium"
        tone="muted"
        style={styles.body}
      >
        {copy.loggedOut[notice]}
      </UiText>
      <Button label={copy.loggedOut.signIn} onPress={() => navigation.navigate('auth.signIn')} />
    </AccountFrame>
  );
}

const styles = StyleSheet.create({
  body: { marginBottom: tokens.spacing.lg },
});
