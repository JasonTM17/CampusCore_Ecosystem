import { useReducer, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import type { MobileScreenProps } from '../../navigation/types';
import { FormField } from '../../components/ui/primitives';
import { AccountFrame } from './AccountFrame';
import { accountApi } from './account-api';
import { classifyError, errorMessage } from './account-errors';
import { forgotReducer, initialForgotState, validateEmail } from './recovery-flow';
import { maskEmail } from './two-factor-flow';
import { useAccountCopy } from './use-account-copy';

/**
 * Anonymous recovery request. The server answers every accepted request the
 * same way, so the banner never says whether an account matched the address.
 */
export function ForgotPasswordScreen({ navigation }: MobileScreenProps) {
  const copy = useAccountCopy();
  const { colors } = useTheme();
  const [state, dispatch] = useReducer(forgotReducer, initialForgotState);
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const sending = state.phase === 'sending';

  const submit = async () => {
    if (sending) return;
    const issue = validateEmail(email);
    if (issue) {
      setFieldError(issue === 'required' ? copy.forgot.emailRequired : copy.forgot.emailInvalid);
      return;
    }
    setFieldError(null);
    dispatch({ type: 'submit', email });
    try {
      await accountApi.forgotPassword(email.trim());
      dispatch({ type: 'accepted' });
    } catch (error) {
      dispatch({ type: 'rejected', failure: classifyError(error) });
    }
  };

  const failure = state.failure ? errorMessage(state.failure, copy.errors) : null;

  return (
    <AccountFrame title={copy.forgot.title} error={failure}>
      {state.phase === 'sent' ? (
        <Card style={[styles.sent, { borderColor: colors.success }]}>
          <View accessible accessibilityLiveRegion="polite" accessibilityRole="alert">
            <UiText variant="headlineSmall">{copy.forgot.sentTitle}</UiText>
            <UiText variant="bodySmall" tone="muted" style={styles.sentBody}>
              {copy.forgot.sentBody.replace('{email}', maskEmail(state.email))}
            </UiText>
          </View>
          <Button
            icon="refresh"
            label={copy.forgot.startOver}
            onPress={() => {
              setEmail('');
              dispatch({ type: 'startOver' });
            }}
            variant="secondary"
          />
        </Card>
      ) : (
        <>
          <FormField
            label={copy.forgot.emailLabel}
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (fieldError) setFieldError(null);
            }}
            error={fieldError ?? undefined}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!sending}
            keyboardType="email-address"
            onSubmitEditing={() => void submit()}
            returnKeyType="send"
            textContentType="emailAddress"
          />
          <Button
            icon="email-outline"
            label={sending ? copy.forgot.sending : copy.forgot.submit}
            loading={sending}
            onPress={() => void submit()}
          />
        </>
      )}
      <Button
        label={copy.common.backToSignIn}
        onPress={() => navigation.navigate('auth.signIn')}
        variant="text"
        style={styles.back}
      />
    </AccountFrame>
  );
}

const styles = StyleSheet.create({
  sent: { gap: tokens.spacing.md },
  sentBody: { marginTop: tokens.spacing.xs },
  back: { marginTop: tokens.spacing.md },
});
