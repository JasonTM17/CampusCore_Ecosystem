import { StyleSheet, View } from 'react-native';

import { Button, StatusPill } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import type { AccountMessages } from '../../i18n/account-messages';

export interface ProfilePhotoControlsProps {
  copy: AccountMessages['profile'];
  pickAvailable: boolean;
  showRemove: boolean;
  unsaved: boolean;
  onPick: () => void;
  onRemove: () => void;
  disabled?: boolean;
}

export function ProfilePhotoControls({
  copy,
  pickAvailable,
  showRemove,
  unsaved,
  onPick,
  onRemove,
  disabled = false,
}: ProfilePhotoControlsProps) {
  if (!pickAvailable) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.actions}>
        <Button
          disabled={disabled}
          icon="camera-outline"
          label={copy.uploadPhoto}
          onBrand
          onPress={onPick}
          variant="secondary"
        />
        {showRemove ? (
          <Button disabled={disabled} label={copy.removePhoto} onBrand onPress={onRemove} variant="text" />
        ) : null}
      </View>
      {unsaved ? (
        <StatusPill label={copy.photoUnsaved} tone="warning" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: tokens.spacing.sm, marginTop: tokens.spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, alignItems: 'center' },
});
