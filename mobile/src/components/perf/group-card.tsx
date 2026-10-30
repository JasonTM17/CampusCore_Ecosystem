import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

import { Card } from '../Ui';

/** Adjacent cells paint one continuous card while keeping every data row virtualized. */
export function GroupCard({ edge, children, style }: {
  edge: 'start' | 'middle' | 'end' | 'single'; children: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  return <Card style={[style, edge !== 'single' ? styles.segment : undefined,
    edge === 'start' ? styles.start : edge === 'middle' ? styles.middle : edge === 'end' ? styles.end : undefined]}>{children}</Card>;
}

const styles = StyleSheet.create({
  segment: { elevation: 0, shadowOpacity: 0 },
  start: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 },
  middle: { borderRadius: 0, borderTopWidth: 0, borderBottomWidth: 0, paddingVertical: 0, marginBottom: 0 },
  end: { borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTopWidth: 0, paddingTop: 0 },
});
