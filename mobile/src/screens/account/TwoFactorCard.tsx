import { useCallback, useEffect, useReducer, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Dialog, IconChip, StatusPill, UiText } from '../../components/Ui';
import { FormField } from '../../components/ui/primitives';
import { tokens } from '../../design/tokens';
import { SecureField } from './SecureField';
import { accountApi } from './account-api';
import { classifyError } from './account-errors';
import {
  initialTwoFactorState,
  isCompleteOtp,
  maskEmail,
  normalizeOtpCode,
  twoFactorErrorKey,
  twoFactorReducer,
  type TwoFactorAction,
} from './two-factor-flow';
import { useAccountCopy } from './use-account-copy';

export interface TwoFactorCardProps {
  email?: string | null;
  /** Called once a change is confirmed; the server has ended other sessions. */
  onCompleted: (action: TwoFactorAction) => void;
}

/**
 * Email-code two-factor settings. The password and the code live in this
 * component's state for one request and are cleared as soon as it settles.
 */
export function TwoFactorCard({ email, onCompleted }: TwoFactorCardProps) {
  const copy = useAccountCopy();
  const text = copy.twoFactor;
  const [state, dispatch] = useReducer(twoFactorReducer, initialTwoFactorState);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const status = await accountApi.twoFactorStatus();
      dispatch({ type: 'statusLoaded', enabled: Boolean(status.enabled) });
    } catch {
      dispatch({ type: 'statusFailed' });
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (state.completed) onCompleted(state.completed);
  }, [state.completed, onCompleted]);

  const cancel = () => {
    setPassword('');
    setCode('');
    dispatch({ type: 'cancel' });
  };

  const submitPassword = async () => {
    if (state.busy) return;
    if (!password) {
      dispatch({ type: 'failed', error: 'passwordRequired' });
      return;
    }
    dispatch({ type: 'requestStarted' });
    try {
      const start = state.action === 'disable'
        ? accountApi.beginTwoFactorDisable
        : accountApi.beginTwoFactorEnable;
      const { challengeId } = await start(password);
      setCode('');
      dispatch({ type: 'challengeStarted', challengeId });
    } catch (error) {
      dispatch({ type: 'failed', error: twoFactorErrorKey(classifyError(error), 'password') });
    } finally {
      setPassword('');
    }
  };

  const submitCode = async () => {
    if (state.busy || !state.challengeId) return;
    if (!isCompleteOtp(code)) {
      dispatch({ type: 'failed', error: 'invalidFormat' });
      return;
    }
    dispatch({ type: 'requestStarted' });
    try {
      const confirm = state.action === 'disable'
        ? accountApi.confirmTwoFactorDisable
        : accountApi.confirmTwoFactorEnable;
      const result = await confirm(state.challengeId, normalizeOtpCode(code));
      dispatch({ type: 'succeeded', enabled: Boolean(result.enabled) });
    } catch (error) {
      dispatch({ type: 'failed', error: twoFactorErrorKey(classifyError(error), 'code') });
    } finally {
      setCode('');
    }
  };

  const status = state.enabled === null
    ? (state.statusFailed ? text.statusUnavailable : text.statusLoading)
    : (state.enabled ? text.statusOn : text.statusOff);

  return (
    <Card>
      <View style={styles.header}>
        <IconChip icon="shield-lock-outline" />
        <UiText accessibilityRole="header" variant="headlineSmall" style={styles.title}>{text.title}</UiText>
        {state.enabled !== null ? (
          <StatusPill label={status} tone={state.enabled ? 'success' : 'neutral'} />
        ) : null}
      </View>
      <UiText variant="bodySmall" tone="muted" style={styles.gap}>{text.description}</UiText>

      {state.enabled === null ? (
        <View style={styles.gap}>
          <UiText accessibilityLiveRegion="polite" variant="bodySmall" tone={state.statusFailed ? 'error' : 'muted'}>
            {status}
          </UiText>
          {state.statusFailed ? (
            <Button label={copy.common.retry} onPress={() => void loadStatus()} variant="secondary" />
          ) : null}
        </View>
      ) : null}

      {state.error ? (
        <View accessible accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.gap}>
          <UiText variant="bodySmall" tone="error">{text.errors[state.error]}</UiText>
        </View>
      ) : null}

      {state.stage === 'idle' && state.enabled !== null ? (
        <Button
          label={state.enabled ? text.disable : text.enable}
          onPress={() => dispatch({ type: 'begin', action: state.enabled ? 'disable' : 'enable' })}
          variant={state.enabled ? 'secondary' : 'primary'}
          style={styles.gap}
        />
      ) : null}

      {state.stage === 'password' ? (
        <View style={styles.gap}>
          <SecureField
            label={text.passwordLabel}
            value={password}
            onChangeText={setPassword}
            autoComplete="current-password"
            editable={!state.busy}
            onSubmitEditing={() => void submitPassword()}
            returnKeyType="done"
            showLabel={copy.common.showPassword}
            hideLabel={copy.common.hidePassword}
          />
          <Button
            label={state.busy ? text.working : text.passwordNext}
            loading={state.busy}
            onPress={() => void submitPassword()}
          />
          <Button label={copy.common.cancel} onPress={cancel} variant="text" disabled={state.busy} />
        </View>
      ) : null}

      {state.stage === 'code' ? (
        <View style={styles.gap}>
          <UiText accessibilityLiveRegion="polite" variant="bodySmall" style={styles.codeNote}>
            {text.codeSent.replace('{email}', maskEmail(email))}
          </UiText>
          <FormField
            label={text.codeLabel}
            value={code}
            onChangeText={(value) => setCode(normalizeOtpCode(value))}
            autoComplete="one-time-code"
            editable={!state.busy}
            keyboardType="number-pad"
            maxLength={6}
            onSubmitEditing={() => void submitCode()}
            returnKeyType="done"
            textContentType="oneTimeCode"
          />
          <Button
            label={state.busy ? text.working : text.confirm}
            loading={state.busy}
            onPress={() => void submitCode()}
          />
          <Button label={copy.common.cancel} onPress={cancel} variant="text" disabled={state.busy} />
        </View>
      ) : null}

      <Dialog
        visible={state.stage === 'confirmDisable'}
        title={text.disableTitle}
        description={text.disableBody}
        confirmLabel={text.disableAction}
        cancelLabel={copy.common.cancel}
        onConfirm={() => dispatch({ type: 'confirmDisable' })}
        onCancel={cancel}
        destructive
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  title: { flex: 1, paddingRight: tokens.spacing.sm },
  gap: { marginTop: tokens.spacing.sm },
  codeNote: { marginBottom: tokens.spacing.sm },
});
