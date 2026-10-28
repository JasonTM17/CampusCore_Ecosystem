import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { Ref } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { UiText } from '../../components/Ui';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';

export interface SecureFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  showLabel: string;
  hideLabel: string;
  autoComplete: 'current-password' | 'new-password';
  error?: string;
  editable?: boolean;
  returnKeyType?: 'next' | 'done';
  onSubmitEditing?: () => void;
  inputRef?: Ref<TextInput>;
  testID?: string;
}

/**
 * Secret text field with a show/hide toggle. The value is owned by the caller
 * and held in component state only; the field never stores, logs or echoes it.
 */
export function SecureField({
  label,
  value,
  onChangeText,
  showLabel,
  hideLabel,
  autoComplete,
  error,
  editable = true,
  returnKeyType,
  onSubmitEditing,
  inputRef,
  testID,
}: SecureFieldProps) {
  const { colors, typography } = useTheme();
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? hideLabel : showLabel;

  return (
    <View style={styles.group}>
      <UiText variant="label" style={styles.label}>{label}</UiText>
      <View
        style={[
          styles.row,
          { backgroundColor: colors.card, borderColor: error ? colors.error : colors.outlineVariant },
        ]}
      >
        <TextInput
          ref={inputRef}
          testID={testID}
          accessibilityLabel={label}
          accessibilityHint={error}
          accessibilityState={{ disabled: !editable }}
          autoCapitalize="none"
          autoComplete={autoComplete}
          autoCorrect={false}
          editable={editable}
          importantForAutofill="yes"
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          secureTextEntry={!visible}
          spellCheck={false}
          textContentType={autoComplete === 'new-password' ? 'newPassword' : 'password'}
          value={value}
          style={[
            styles.input,
            { color: colors.text, fontFamily: typography.family, fontSize: typography.bodyMedium.fontSize },
          ]}
        />
        <Pressable
          accessibilityLabel={toggleLabel}
          accessibilityRole="button"
          accessibilityState={{ selected: visible }}
          hitSlop={4}
          onPress={() => setVisible((current) => !current)}
          style={styles.toggle}
        >
          <MaterialCommunityIcons
            color={colors.textMuted}
            name={visible ? 'eye-off-outline' : 'eye-outline'}
            size={22}
          />
        </Pressable>
      </View>
      {error ? (
        <UiText accessibilityRole="alert" variant="bodySmall" tone="error" style={styles.error}>
          {error}
        </UiText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: tokens.spacing.md },
  label: { marginBottom: tokens.spacing.xs },
  row: {
    alignItems: 'center',
    borderRadius: tokens.radii.control,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: tokens.layout.touchTarget,
    paddingLeft: tokens.spacing.md,
  },
  input: { flex: 1, minHeight: tokens.layout.touchTarget, paddingVertical: tokens.spacing.sm },
  toggle: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: tokens.layout.touchTarget,
    minWidth: tokens.layout.touchTarget,
  },
  error: { marginTop: tokens.spacing.xs },
});
