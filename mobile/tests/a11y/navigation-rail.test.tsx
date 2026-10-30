import { localizedNavLabel, shellMessages } from '../../src/i18n/shell-messages';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import { NavigationRail } from '../../src/components/NavigationRail';
import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { chromeFor } from '../../src/design/chrome';
import { getBottomNavigation } from '../../src/navigation/routes';
import { auditTree } from './audit';

afterEach(() => { jest.restoreAllMocks(); });

describe('NavigationRail accessibility and theme', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const role of ['student', 'lecturer', 'admin'] as const) {
      test(`${role} ${scheme} at fontScale 1.5 has no violations or truncated actions`, async () => {
        jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 1000, height: 800, scale: 2, fontScale: 1.5 });
        const items = getBottomNavigation(role);
        const chrome = chromeFor(scheme);
        await render(
          <ThemeProvider forcedScheme={scheme}>
            <NavigationRail activeRoute={items[0].route} role={role} onNavigate={() => {}} onMenu={() => {}} />
          </ThemeProvider>,
        );
        const audit = auditTree(screen.toJSON() as never);
        expect(audit.violations).toEqual([]);
        expect(audit.unknownSize).toBe(0);
        expect(screen.getByTestId('navigation-rail')).toHaveStyle({ backgroundColor: chrome.surfaceStrong, borderRightColor: chrome.overlay });
        for (const [index, item] of items.entries()) {
          const label = screen.getByText(localizedNavLabel('vi', item.label));
          expect(label).toHaveStyle({ color: index === 0 ? chrome.onSurface : chrome.onSurfaceMuted });
        }
        const actions = [...screen.getAllByRole('tab'), screen.getByRole('button', { name: 'Mở menu' })];
        for (const action of actions) {
          const style = StyleSheet.flatten(action.props.style);
          expect(style.minHeight).toBeGreaterThanOrEqual(44);
          expect(style.minWidth).toBeGreaterThanOrEqual(44);
          expect(style.height).toBeUndefined();
          expect(style.overflow).not.toBe('hidden');
        }
        // Audit rule e permits a redundant visual label to truncate when an
        // accessibilityLabel exists. Rail labels must wrap visually as well.
        for (const label of [...items.map((item) => localizedNavLabel('vi', item.label)), 'Menu']) {
          const text = screen.getByText(label);
          expect(text.props.numberOfLines).toBeUndefined();
          expect(text.props.adjustsFontSizeToFit).not.toBe(true);
          expect(text.props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(1.5);
        }
      });
    }
  }
});
