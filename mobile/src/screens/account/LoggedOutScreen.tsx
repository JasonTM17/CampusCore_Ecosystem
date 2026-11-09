import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, IconChip, StatusPill, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import type { MobileScreenProps } from '../../navigation/types';
import { AccountFrame } from './AccountFrame';
import { takeExitNotice } from './exit-notice';
import { useAccountCopy } from './use-account-copy';
import { useOptionalSession } from '../../session/SessionContext';

/** Destination after the session ended; the wipe already ran in the session layer. */
export function LoggedOutScreen({ navigation }: MobileScreenProps) {
  const copy = useAccountCopy();
  const [notice] = useState(takeExitNotice);
  const session = useOptionalSession();

  useEffect(() => {
    if (session?.signingOut) session.clearSigningOut();
  }, [session?.signingOut, session?.clearSigningOut]);

  const signedOut = notice === 'signedOut';

  return (
    <AccountFrame title={signedOut ? copy.loggedOut.securedTitle : copy.loggedOut.title}>
      <View style={styles.content}>
        <View style={styles.noticeRow}>
          <IconChip icon={signedOut ? 'shield-check-outline' : 'lock-outline'} size={36} tone={signedOut ? 'success' : 'primary'} />
          <View style={styles.bodyColumn}>
            {signedOut ? <StatusPill label={copy.loggedOut.securedBadge} tone="success" /> : null}
            <UiText
              accessibilityLiveRegion="polite"
              variant="bodyMedium"
              tone={signedOut ? 'success' : 'muted'}
            >
              {signedOut ? copy.loggedOut.signedOutPortal : copy.loggedOut[notice]}
            </UiText>
          </View>
        </View>
        <Button
          icon="login"
          label={copy.loggedOut.signIn}
          onPress={() => navigation.navigate('auth.signIn')}
        />
      </View>
    </AccountFrame>
  );
}

const styles = StyleSheet.create({
  content: { gap: tokens.spacing.md },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, marginBottom: tokens.spacing.sm },
  bodyColumn: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
});
