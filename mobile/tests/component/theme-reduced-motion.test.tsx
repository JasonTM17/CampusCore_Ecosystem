import { describe, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';

import { ThemeProvider, useTheme } from '../../src/design/theme';
import { UiText } from '../../src/components/ui/UiText';

function ThemeProbe() {
  const { reducedMotion } = useTheme();
  return <Text testID="reduced-motion">{String(reducedMotion)}</Text>;
}

describe('reduced motion subscription', () => {
  test('shares one native setting query and listener across themed text', async () => {
    const settingQuery = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const eventListener = jest.spyOn(AccessibilityInfo, 'addEventListener');
    const { unmount } = await render(
      <ThemeProvider forcedScheme="light">
        <UiText>First</UiText>
        <UiText>Second</UiText>
      </ThemeProvider>,
    );
    try {
      expect(settingQuery).toHaveBeenCalledTimes(1);
      expect(eventListener).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
      jest.restoreAllMocks();
    }
  });

  test('does not let a late initial query replace a newer setting event', async () => {
    let resolveSetting!: (value: boolean) => void;
    const initialSetting = new Promise<boolean>((resolve) => { resolveSetting = resolve; });
    let changed: ((value: boolean) => void) | undefined;
    const settingQuery = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(initialSetting);
    const remove = jest.fn();
    const eventListener = jest.spyOn(AccessibilityInfo, 'addEventListener') as unknown as jest.Mock<
      (eventName: string, callback: (value: boolean) => void) => { remove(): void }
    >;
    eventListener.mockImplementation((_event, callback) => {
      changed = callback as (value: boolean) => void;
      return { remove };
    });
    const { unmount } = await render(<ThemeProvider forcedScheme="light"><ThemeProbe /></ThemeProvider>);
    try {
      expect(settingQuery).toHaveBeenCalled();
      await act(async () => { changed?.(true); });
      expect(screen.getByTestId('reduced-motion').props.children).toBe('true');
      await act(async () => { resolveSetting(false); await initialSetting; });
      expect(screen.getByTestId('reduced-motion').props.children).toBe('true');
      expect(eventListener).toHaveBeenCalled();
    } finally {
      unmount();
      jest.restoreAllMocks();
    }
  });
});
