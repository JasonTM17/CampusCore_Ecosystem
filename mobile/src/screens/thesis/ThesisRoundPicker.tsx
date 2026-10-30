import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ListPanel } from '../../components/perf/performance-list';

import { Button, UiText } from '../../components/Ui';
import { Sheet } from '../../components/ui/primitives';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
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
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  if (!current) return null;
  return (
    <View style={[styles.bar, { backgroundColor: colors.card, borderColor: colors.outlineVariant }]}>
      <View style={styles.name}>
        <UiText variant="meta" tone="muted">{copy.roundPicker}</UiText>
        <UiText variant="label">{current.name}</UiText>
      </View>
      <ThesisStatusBadge status={current.status} copy={copy} />
      {rounds.length > 1 ? <Button label={copy.roundChange} variant="text" onPress={() => setOpen(true)} /> : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={copy.roundPickTitle}>
        <ListPanel
      list={{ data: rounds, keyExtractor: (item, index) => String(item.id),
        renderItem: ({ item: round }) => (
            <Button
              key={round.id}
              label={round.name}
              accessibilityLabel={`${round.name}, ${statusLabel(copy, round.status)}${round.id === current.id ? `, ${copy.roundPickCurrent}` : ''}`}
              variant={round.id === current.id ? 'primary' : 'secondary'}
              onPress={() => { onSelect(round.id); setOpen(false); }}
              style={styles.option}
            />
          ),
        footer: <>{null}
        </>,
      }}
    >
          {null}</ListPanel>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { alignItems: 'center', borderRadius: tokens.radii.card, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginBottom: tokens.spacing.sm, padding: tokens.spacing.sm + tokens.spacing.xs },
  name: { flex: 1, minWidth: 120 },
  option: { marginBottom: tokens.spacing.xs },
});
