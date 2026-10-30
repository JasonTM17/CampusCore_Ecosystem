import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, IconChip, UiText } from '../../components/Ui';
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
      <View style={styles.content}>
        <View style={styles.noticeRow}>
          <IconChip icon="lock-outline" size={36} tone="primary" />
          <UiText
            accessibilityLiveRegion="polite"
            variant="bodyMedium"
            tone="muted"
            style={styles.body}
          >
            {copy.loggedOut[notice]}
          </UiText>
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
  body: { flex: 1 },
});
