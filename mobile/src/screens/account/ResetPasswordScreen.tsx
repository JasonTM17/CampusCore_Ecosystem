import { useReducer, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import type { MobileScreenProps } from '../../navigation/types';
import { AccountFrame } from './AccountFrame';
import { SecureField } from './SecureField';
import { accountApi } from './account-api';
import { accountScreen } from './account-routes';
import { classifyError, errorMessage } from './account-errors';
import { checkPasswordPolicy, passwordChecklist } from './password-policy';
import { initialResetState, resetReducer } from './recovery-flow';
import { useAccountCopy } from './use-account-copy';

export interface ResetPasswordScreenProps extends MobileScreenProps {
  /** Validated token from the deep link; null or absent shows the invalid state. */
  initialToken?: string | null;
}

/**
 * One-time token redemption. The token is captured once into memory, never
 * rendered, logged or persisted, and dropped as soon as the flow ends.
 */
export function ResetPasswordScreen({ navigation, initialToken = null }: ResetPasswordScreenProps) {
  const copy = useAccountCopy();
  const { colors } = useTheme();
  const tokenRef = useRef<string | null>(initialToken);
  const [state, dispatch] = useReducer(resetReducer, initialToken, initialResetState);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const confirmRef = useRef<TextInput>(null);
  const submitting = state.phase === 'submitting';

  const submit = async () => {
    const token = tokenRef.current;
    if (!token || submitting) return;
    const issue = checkPasswordPolicy(password, { confirmPassword: confirmation });
    if (issue) {
      setLocalError(copy.errors.codes[issue]);
      return;
    }
    setLocalError(null);
    dispatch({ type: 'submit' });
    try {
      await accountApi.resetPassword(token, password);
      tokenRef.current = null;
      setPassword('');
      setConfirmation('');
      dispatch({ type: 'succeeded' });
    } catch (error) {
      const failure = classifyError(error);
      if (failure.code === 'RESET_TOKEN_INVALID') tokenRef.current = null;
      dispatch({ type: 'failed', failure });
    }
  };

  if (state.phase === 'tokenInvalid') {
    return (
      <AccountFrame title={copy.reset.invalidTitle}>
        <Card tone="low" style={styles.panel}>
          <UiText variant="bodyMedium">{copy.reset.invalidBody}</UiText>
        </Card>
        <Button
          icon="refresh"
          label={copy.reset.requestNewLink}
          onPress={() => navigation.navigate(accountScreen('forgotPassword'))}
        />
        <Button
          label={copy.common.backToSignIn}
          onPress={() => navigation.navigate('auth.signIn')}
          variant="text"
          style={styles.back}
        />
      </AccountFrame>
    );
  }

  if (state.phase === 'done') {
    return (
      <AccountFrame title={copy.reset.doneTitle}>
        <Card style={[styles.panel, { borderColor: colors.success }]}>
          <View accessibilityLiveRegion="polite">
            <UiText variant="bodyMedium">{copy.reset.doneBody}</UiText>
          </View>
        </Card>
        <Button
          icon="login"
          label={copy.reset.goToSignIn}
          onPress={() => navigation.navigate('auth.signIn')}
        />
      </AccountFrame>
    );
  }

  const serverError = state.failure ? errorMessage(state.failure, copy.errors) : null;
  const checklistText = {
    length: copy.reset.checklistLength,
    letterDigit: copy.reset.checklistLetterDigit,
    match: copy.reset.checklistMatch,
  };

  return (
    <AccountFrame title={copy.reset.title} error={localError ?? serverError}>
      <SecureField
        label={copy.reset.newPassword}
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
        editable={!submitting}
        onSubmitEditing={() => confirmRef.current?.focus()}
        returnKeyType="next"
        showLabel={copy.common.showPassword}
        hideLabel={copy.common.hidePassword}
      />
      <SecureField
        label={copy.reset.confirmPassword}
        value={confirmation}
        onChangeText={setConfirmation}
        autoComplete="new-password"
        editable={!submitting}
        inputRef={confirmRef}
        onSubmitEditing={() => void submit()}
        returnKeyType="done"
        showLabel={copy.common.showPassword}
        hideLabel={copy.common.hidePassword}
      />
      <View style={styles.checklist}>
        {passwordChecklist(password, confirmation).map((item) => (
          <UiText
            key={item.key}
            accessibilityLabel={`${checklistText[item.key]}: ${item.met ? copy.reset.checklistMet : copy.reset.checklistUnmet}`}
            variant="bodySmall"
            tone={item.met ? 'success' : 'muted'}
          >
            {`${item.met ? '✓' : '○'} ${checklistText[item.key]}`}
          </UiText>
        ))}
      </View>
      <Button
        icon="lock-check-outline"
        label={submitting ? copy.reset.saving : copy.reset.submit}
        loading={submitting}
        onPress={() => void submit()}
      />
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
  panel: { marginBottom: tokens.spacing.md },
  checklist: { gap: tokens.spacing.xs, marginBottom: tokens.spacing.md },
  back: { marginTop: tokens.spacing.md },
});
