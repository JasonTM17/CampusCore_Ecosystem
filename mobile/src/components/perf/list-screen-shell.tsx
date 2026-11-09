import { StyleSheet, View } from 'react-native';

import { ScreenShell, type ScreenShellProps } from '../Ui';
import { UiText } from '../ui/UiText';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';
import { PerformanceList, type PerformanceListProps } from './performance-list';

export type ListScreenShellProps<T> = ScreenShellProps & { list: PerformanceListProps<T> };

export function ScrollableScreenShell<T>({ list, ...props }: ScreenShellProps & { list?: PerformanceListProps<T> }) {
  return list ? <ListScreenShell {...props} list={list} /> : <ScreenShell {...props} />;
}

/** ScreenShell's heading and responsive width, with the header inside the list. */
export function ListScreenShell<T>({ title, eyebrow, subtitle, headerAction, hideHeader,
  contentStyle, children, list, refreshControl }: ListScreenShellProps<T>) {
  const { colors, window } = useTheme();
  const maxWidth = window.class === 'compact' ? undefined : tokens.windowClasses.contentMaxWidth[window.class];
  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <PerformanceList
      key={list.numColumns ?? 1}
      {...list}
      refreshControl={refreshControl ?? list.refreshControl}
      style={[maxWidth ? { alignSelf: 'center', maxWidth, width: '100%' } : undefined, list.style]}
      contentContainerStyle={[contentStyle, list.contentContainerStyle]}
      header={<>
        {hideHeader ? null : <View style={styles.heading}>
          <View style={styles.copy}>
            {eyebrow ? <UiText variant="meta" tone="primary" style={styles.eyebrow}>{eyebrow.toUpperCase()}</UiText> : null}
            <View testID="page-title-tab" style={[styles.pageTab, { backgroundColor: colors.primary }]}>
              <UiText accessibilityRole="header" variant="label" style={[styles.pageTabTitle, { color: colors.onPrimary }]}>{title}</UiText>
            </View>
            {subtitle ? <UiText variant="bodySmall" tone="muted" style={styles.subtitle}>{subtitle}</UiText> : null}
          </View>
          {headerAction}
        </View>}
        {children}
        {list.header}
      </>}
    />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: tokens.spacing.md },
  copy: { flex: 1, paddingRight: tokens.spacing.sm },
  eyebrow: { letterSpacing: 0, marginBottom: tokens.spacing.xs, textTransform: 'uppercase' },
  pageTab: { alignSelf: 'flex-start', borderTopLeftRadius: tokens.radii.card, borderTopRightRadius: tokens.radii.card, maxWidth: '100%', paddingHorizontal: 20, paddingVertical: 10 },
  pageTabTitle: { fontSize: 14, lineHeight: 20 },
  subtitle: { marginTop: tokens.spacing.xs },
});
