import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { LanguageSetting } from '../../src/screens/account/LanguageSetting';
import { auditTree } from '../a11y/audit';

describe('LanguageSetting', () => {
  test('switches the locale, persists it and relabels itself', async () => {
    const storage = { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) };
    await render(
      <ThemeProvider forcedScheme="light">
        <LocaleProvider storage={storage}>
          <LanguageSetting />
        </LocaleProvider>
      </ThemeProvider>,
    );
    expect(screen.getByText('Ngôn ngữ')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Tiếng Việt' })).toBeSelected();
    await fireEvent.press(screen.getByRole('tab', { name: 'English' }));
    expect(screen.getByText('Language')).toBeOnTheScreen();
    expect(storage.setItem).toHaveBeenCalledWith('campusute.locale', 'en');
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });
});
