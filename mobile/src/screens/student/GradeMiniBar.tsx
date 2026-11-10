import { StyleSheet, View } from 'react-native';

import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';

type ScoreTier = 'strong' | 'fair' | 'weak';

function scoreTier(score: number | null | undefined): ScoreTier | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (score >= 8) return 'strong';
  if (score >= 5) return 'fair';
  return 'weak';
}

function scoreBarPercent(score: number): number {
  return Math.min(100, Math.max(0, (score / 10) * 100));
}

export interface GradeMiniBarProps {
  score: number | null | undefined;
}

/** Decorative 0–10 score bar beside the numeric grade (web GradeMiniBar parity). */
export function GradeMiniBar({ score }: GradeMiniBarProps) {
  const { colors } = useTheme();
  const tier = scoreTier(score);
  if (!tier || typeof score !== 'number' || !Number.isFinite(score)) return null;
  const fill = { strong: colors.success, fair: colors.warning, weak: colors.error }[tier];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, { backgroundColor: colors.surfaceHigh }]}
      testID="grade-mini-bar"
    >
      <View style={[styles.fill, { width: `${scoreBarPercent(score)}%`, backgroundColor: fill }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderRadius: tokens.radii.control, height: 6, overflow: 'hidden', width: 64 },
  fill: { borderRadius: tokens.radii.control, height: '100%' },
});
