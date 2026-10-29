import { useCallback, useMemo, type ReactElement, type ReactNode, type Ref } from 'react';
import { FlatList, Platform, StyleSheet, View, type FlatListProps } from 'react-native';

import { tokens } from '../../design/tokens';

export interface PerformanceListProps<T> extends Omit<FlatListProps<T>, 'ListHeaderComponent' | 'ListFooterComponent' | 'ListEmptyComponent' | 'data' | 'renderItem' | 'keyExtractor'> {
  data: readonly T[];
  keyExtractor: NonNullable<FlatListProps<T>['keyExtractor']>;
  renderItem: NonNullable<FlatListProps<T>['renderItem']>;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  empty?: ReactElement | null;
  listRef?: Ref<FlatList<T>>;
  /** Inline sheets/chat already supply their own padding and navigation inset. */
  gutters?: boolean;
}

/** One bounded native render window; never nest inside a vertical ScrollView. */
export function PerformanceList<T>({ header, footer, empty, listRef, gutters = true,
  contentContainerStyle, ...props }: PerformanceListProps<T>) {
  const contentStyle = useMemo(() => [gutters ? styles.content : undefined, contentContainerStyle], [gutters, contentContainerStyle]);
  return (
    <FlatList
      ref={listRef}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={7}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews={Platform.OS === 'android'}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      {...props}
      contentContainerStyle={contentStyle}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={empty}
    />
  );
}

/** Stable separator identity avoids unmounting separators on list state updates. */
export function ListGap() { return <View style={styles.gap} />; }

/** Inline sheet adapter with the same render window and one scrolling surface. */
export function ListPanel<T>({ list, children }: { list: PerformanceListProps<T>; children?: ReactNode }) {
  return <PerformanceList gutters={false} {...list} header={<>{children}{list.header}</>} />;
}

/** Adapt existing item/index row renderers without allocating a callback per cell. */
export function useListRenderer<T>(render: (item: T, index: number) => ReactElement | null) {
  return useCallback<NonNullable<FlatListProps<T>['renderItem']>>(({ item, index }) => render(item, index), [render]);
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: tokens.layout.mobileGutter, paddingTop: tokens.spacing.md,
    paddingBottom: tokens.spacing.xl + tokens.layout.bottomNavigationHeight },
  gap: { height: tokens.spacing.sm },
});
