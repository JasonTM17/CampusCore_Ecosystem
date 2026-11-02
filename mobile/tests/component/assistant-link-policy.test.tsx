import { afterEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { ThemeProvider } from '../../src/design/theme';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

import { MarkdownText } from '../../src/screens/assistant/MarkdownText';

// jest-expo does not set this; without it RNTL's internal act() cannot flush
// updates, which leaves presses landing on stale/disabled elements.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test('assistant markdown dispatches allowed routes through Expo Router and never Linking.openURL', async () => {
  const openUrl = jest.spyOn(Linking, 'openURL');
  await render(
    <ThemeProvider forcedScheme="light">
      <MarkdownText text="Open [schedule](/dashboard/schedule) and [outside](https://example.edu/policy)." />
    </ThemeProvider>,
  );

  fireEvent.press(screen.getByRole('link', { name: 'schedule' }));
  expect(mockPush).toHaveBeenCalledWith('/schedule');
  expect(screen.queryByRole('link', { name: 'outside' })).toBeNull();
  expect(screen.getByText(/outside/)).toBeOnTheScreen();
  expect(openUrl).not.toHaveBeenCalled();
});

test('published document revision links resolve to the guarded mobile docs screen', async () => {
  await render(
    <ThemeProvider forcedScheme="light">
      <MarkdownText text="Read [the regulation](/docs/quy-che?rev=2)." />
    </ThemeProvider>,
  );

  fireEvent.press(screen.getByRole('link', { name: 'the regulation' }));
  expect(mockPush).toHaveBeenCalledWith('/docs?slug=quy-che&rev=2');
});
