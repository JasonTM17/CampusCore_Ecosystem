import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import type { ReactElement } from 'react';

import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { useLocale } from '../../i18n/locale-provider';
import { Button } from './Button';
import { EmptyState, InlineError, Skeleton } from './primitives';
import { UiText } from './UiText';
import { PerformanceList, ListGap, useListRenderer } from '../perf/performance-list';

export interface DataListProps<T> {
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactElement | null;
  /** First load in progress; skeleton rows show only while the list is empty. */
  loading?: boolean;
  /** Error text. With no rows it replaces the list; with rows it sits above them. */
  error?: string | null;
  onRetry?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  header?: ReactElement | null;
  accessibilityLabel?: string;
  testID?: string;
}

const SKELETON_ROWS = 3;

export function DataList<T>({
  data,
  keyExtractor,
  renderItem,
  loading = false,
  error,
  onRetry,
  refreshing = false,
  onRefresh,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  emptyTitle,
  emptyDescription,
  header,
  accessibilityLabel,
  testID,
}: DataListProps<T>) {
  const { colors, spacing, layout } = useTheme();
  const { t } = useLocale();
  const empty = data.length === 0;
  const canLoadMore = hasMore && !loadingMore && !error && Boolean(onLoadMore);
  const renderRow = useListRenderer(renderItem);

  const errorBanner = error ? <InlineError message={error} onRetry={onRetry} retryLabel={t('retry')} /> : null;

  let emptyComponent: ReactElement | null = null;
  if (empty && loading) {
    emptyComponent = (
      <View accessibilityLabel={t('loading')} accessibilityLiveRegion="polite" accessibilityState={{ busy: true }} style={{ gap: spacing.sm }}>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <Skeleton key={i} height={layout.touchTarget + spacing.md} />
        ))}
      </View>
    );
  } else if (empty && error) {
    emptyComponent = errorBanner;
  } else if (empty) {
    emptyComponent = <EmptyState title={emptyTitle ?? t('empty')} description={emptyDescription} />;
  }

  const footer = loadingMore ? (
    <View accessibilityLiveRegion="polite" style={[styles.footer, { minHeight: layout.touchTarget }]}>
      <ActivityIndicator color={colors.primary} size="small" />
      <UiText variant="bodySmall" tone="muted">{t('loadingMore')}</UiText>
    </View>
  ) : canLoadMore && !empty ? (
    <View style={styles.footer}>
      <Button label={t('loadMore')} onPress={onLoadMore as () => void} variant="secondary" />
    </View>
  ) : null;

  return (
    <PerformanceList
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      data={data}
      keyExtractor={keyExtractor}
      renderItem={renderRow}
      header={
        <>
          {header}
          {!empty && errorBanner ? <View style={{ marginBottom: spacing.sm }}>{errorBanner}</View> : null}
        </>
      }
      empty={emptyComponent}
      footer={footer}
      ItemSeparatorComponent={ListGap}
      onEndReached={canLoadMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.4}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} /> : undefined}
    />
  );
}

const styles = StyleSheet.create({
  footer: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm, justifyContent: 'center', paddingVertical: tokens.spacing.md },
});
