import { afterEach, expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { Dimensions, FlatList, RefreshControl, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { createRef } from 'react';
import type { ReactElement } from 'react';

import { ASSISTANT_FAB_CLEARANCE } from '../../src/components/AssistantFab';
import { ScreenShell } from '../../src/components/Ui';
import { PerformanceList } from '../../src/components/perf/performance-list';
import { cardRows, renderVirtualRow } from '../../src/components/perf/virtual-rows';
import { tokens } from '../../src/design/tokens';

afterEach(() => { jest.restoreAllMocks(); });

test('screen scroll content keeps normal gutters and enough bottom clearance at supported widths and scales', async () => {
  const getDimensions = jest.spyOn(Dimensions, 'get');

  for (const width of [360, 390, 411, 1000]) {
    for (const fontScale of [1, 2]) {
      getDimensions.mockReturnValue({ width, height: 800, scale: 2, fontScale } as ReturnType<typeof Dimensions.get>);
      const view = await render(<ScreenShell title="Screen"><Text>screen content</Text></ScreenShell>);

      type TestNode = { parent?: TestNode | null; props: Record<string, unknown> };
      const screenText = view.getByText('screen content') as unknown as TestNode;
      let parent = screenText.parent;
      while (parent && parent.props.contentContainerStyle === undefined) parent = parent.parent;
      const scrollStyle = StyleSheet.flatten(parent?.props.contentContainerStyle as StyleProp<ViewStyle>);
      expect(scrollStyle?.paddingHorizontal).toBe(tokens.layout.mobileGutter);
      expect(scrollStyle?.paddingEnd ?? tokens.layout.mobileGutter).toBeLessThanOrEqual(tokens.layout.mobileGutter);
      expect(scrollStyle?.paddingBottom).toBeGreaterThanOrEqual(ASSISTANT_FAB_CLEARANCE);
      await view.unmount();
    }
  }
});

test('performance-list content keeps normal gutters and enough bottom clearance at supported widths and scales', async () => {
  const getDimensions = jest.spyOn(Dimensions, 'get');
  const data = ['row'];
  const listRef = createRef<FlatList<string>>();

  for (const width of [360, 390, 411, 1000]) {
    for (const fontScale of [1, 2]) {
      getDimensions.mockReturnValue({ width, height: 800, scale: 2, fontScale } as ReturnType<typeof Dimensions.get>);
      const view = await render(
        <PerformanceList listRef={listRef} data={data} keyExtractor={(item) => item} renderItem={({ item }) => <Text>{item}</Text>} />,
      );

      const listStyle = StyleSheet.flatten(listRef.current?.props.contentContainerStyle as StyleProp<ViewStyle>);
      expect(listStyle?.paddingHorizontal).toBe(tokens.layout.mobileGutter);
      expect(listStyle?.paddingEnd ?? tokens.layout.mobileGutter).toBeLessThanOrEqual(tokens.layout.mobileGutter);
      expect(listStyle?.paddingBottom).toBeGreaterThanOrEqual(ASSISTANT_FAB_CLEARANCE);
      await view.unmount();
    }
  }
});

test('rendered performance cards span the viewport minus two normal gutters at compact widths', async () => {
  const getDimensions = jest.spyOn(Dimensions, 'get');
  const listRef = createRef<FlatList<string>>();

  for (const width of [360, 393]) {
    getDimensions.mockReturnValue({ width, height: 800, scale: 2, fontScale: 1 } as ReturnType<typeof Dimensions.get>);
    const view = await render(
      <PerformanceList
        listRef={listRef}
        data={['card']}
        keyExtractor={(item) => item}
        renderItem={() => <View testID="rendered-card" style={{ alignSelf: 'stretch', minHeight: 72 }} />}
      />,
    );

    const card = view.getByTestId('rendered-card');
    expect(StyleSheet.flatten(card.props.style as StyleProp<ViewStyle>)?.alignSelf).toBe('stretch');
    const contentStyle = StyleSheet.flatten(listRef.current?.props.contentContainerStyle as StyleProp<ViewStyle>)!;
    const numericInset = (value: unknown) => typeof value === 'number' ? value : 0;
    const leftInset = Math.max(numericInset(contentStyle.paddingStart), numericInset(contentStyle.paddingLeft), numericInset(contentStyle.paddingHorizontal));
    const rightInset = Math.max(numericInset(contentStyle.paddingEnd), numericInset(contentStyle.paddingRight), numericInset(contentStyle.paddingHorizontal));
    const computedCardWidth = width - leftInset - rightInset;
    expect(computedCardWidth).toBe(width - tokens.layout.mobileGutter * 2);
    await view.unmount();
  }
});

test('header, empty, footer, refresh and paging retain the native list contract', async () => {
  const refresh = jest.fn(), page = jest.fn();
  const ref = createRef<FlatList<string>>();
  const view = await render(<PerformanceList<string>
    listRef={ref}
    data={[]} keyExtractor={(item) => item} renderItem={({ item }) => <Text>{item}</Text>}
    header={<Text>filters</Text>} empty={<Text>empty</Text>} footer={<Text>more</Text>}
    refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
    onEndReached={page}
  />);
  for (const text of ['filters', 'empty', 'more']) expect(view.getByText(text)).toBeOnTheScreen();
  const list = ref.current!;
  list.props.onEndReached!({ distanceFromEnd: 0 });
  const control = list.props.refreshControl!;
  control.props.onRefresh!();
  expect(page).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('200 variable-height rows mount a bounded initial window with stable IDs', async () => {
  let mounted = 0;
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: `row-${i}`, text: 'row '.repeat(i % 6 + 1) }));
  function Row({ text }: { text: string }) { mounted++; return <Text>{text}</Text>; }
  const key = (item: typeof rows[number]) => item.id;
  const ref = createRef<FlatList<typeof rows[number]>>();
  await render(<PerformanceList listRef={ref} data={rows} keyExtractor={key} renderItem={({ item }) => <Row text={item.text} />} />);
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThanOrEqual(8);
  const list = ref.current!;
  expect(list.props.keyExtractor!(rows[3], 3)).toBe('row-3');
  expect(list.props.keyExtractor!(rows[3], 0)).toBe('row-3');
  expect(list.props.getItemLayout).toBeUndefined();
  expect(list.props.contentContainerStyle).toBeDefined();
});

test('a single card containing 200 records still mounts at most seven record trees', async () => {
  let rendered = 0;
  const data = cardRows('group', Array.from({ length: 200 }, (_, id) => id), String,
    <Text>group header</Text>, (item) => { rendered++; return <Text>{`record-${item}`}</Text>; },
    { footer: <Text>group footer</Text> });
  expect(rendered).toBe(0);
  const view = await render(<PerformanceList data={data} keyExtractor={(row) => row.key} renderItem={renderVirtualRow} />);
  expect(view.getByText('group header')).toBeOnTheScreen();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThanOrEqual(7);
});

test('card rows without a header start with the first data row', async () => {
  const rows = cardRows('group', [1], (_item, index) => String(index), null as unknown as ReactElement,
    (item) => <Text>{`record-${item}`}</Text>);
  expect(rows.map((row) => row.key)).toEqual(['group:0']);
  const view = await render(<PerformanceList data={rows} keyExtractor={(row) => row.key} renderItem={renderVirtualRow} />);
  expect(view.getByText('record-1')).toBeOnTheScreen();
});
