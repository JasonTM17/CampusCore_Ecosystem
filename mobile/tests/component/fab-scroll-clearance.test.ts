import { expect, test } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { createElement } from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { ScreenShell } from '../../src/components/Ui';
import { ASSISTANT_FAB_SIZE } from '../../src/components/assistant-fab-insets';
import { PerformanceList } from '../../src/components/perf/performance-list';
import { tokens } from '../../src/design/tokens';

const minimumSpacerHeight = ASSISTANT_FAB_SIZE + tokens.spacing.md;

test('ScreenShell ends its scroll content with enough assistant clearance', async () => {
  const screen = await render(createElement(ScreenShell, {
    title: 'Screen',
    children: createElement(Text, null, 'screen content'),
  }));

  const spacer = screen.getByTestId('assistant-scroll-spacer');
  const height = StyleSheet.flatten(spacer.props.style as StyleProp<ViewStyle>)?.height;
  expect(height).toBeGreaterThanOrEqual(minimumSpacerHeight);
  await screen.unmount();
});

test('PerformanceList ends its footer with enough assistant clearance', async () => {
  const list = await render(createElement(PerformanceList<string>, {
    data: ['row'],
    keyExtractor: (item: string) => item,
    renderItem: ({ item }: { item: string }) => createElement(Text, null, item),
  }));

  const spacer = list.getByTestId('assistant-scroll-spacer');
  const height = StyleSheet.flatten(spacer.props.style as StyleProp<ViewStyle>)?.height;
  expect(height).toBeGreaterThanOrEqual(minimumSpacerHeight);
  await list.unmount();
});
