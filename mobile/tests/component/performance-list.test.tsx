import { expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { FlatList, RefreshControl, Text } from 'react-native';
import { createRef } from 'react';

import { PerformanceList } from '../../src/components/perf/performance-list';
import { cardRows, renderVirtualRow } from '../../src/components/perf/virtual-rows';

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
