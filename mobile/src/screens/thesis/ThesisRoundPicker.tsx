import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, UiText } from '../../components/Ui';
import { Sheet } from '../../components/ui/primitives';
import { tokens } from '../../design/tokens';
import type { ThesisCopy } from '../../i18n/thesis-messages';
import { statusLabel, type ThesisRound } from './thesis-model';
import { ThesisStatusBadge } from './thesis-ui';

export interface ThesisRoundPickerProps {
  rounds: readonly ThesisRound[];
  current: ThesisRound | null;
  onSelect: (roundId: string) => void;
  copy: ThesisCopy;
}

/** Current round with a sheet to switch; hidden controls when there is nothing to switch to. */
export function ThesisRoundPicker({ rounds, current, onSelect, copy }: ThesisRoundPickerProps) {
  const [open, setOpen] = useState(false);
  if (!current) return null;
  return (
    <View style={styles.bar}>
      <View style={styles.name}>
        <UiText variant="meta" tone="muted">{copy.roundPicker}</UiText>
        <UiText variant="label" numberOfLines={2}>{current.name}</UiText>
      </View>
      <ThesisStatusBadge status={current.status} copy={copy} />
      {rounds.length > 1 ? <Button label={copy.roundChange} variant="text" onPress={() => setOpen(true)} /> : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={copy.roundPickTitle}>
        <ScrollView>
          {rounds.map((round) => (
            <Button
              key={round.id}
              label={round.name}
              accessibilityLabel={`${round.name}, ${statusLabel(copy, round.status)}${round.id === current.id ? `, ${copy.roundPickCurrent}` : ''}`}
              variant={round.id === current.id ? 'primary' : 'secondary'}
              onPress={() => { onSelect(round.id); setOpen(false); }}
              style={styles.option}
            />
          ))}
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginBottom: tokens.spacing.sm },
  name: { flex: 1, minWidth: 160 },
  option: { marginBottom: tokens.spacing.xs },
});
