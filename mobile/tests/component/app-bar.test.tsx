import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

const mockApi = { mode: 'preview' as 'preview' | 'live' };
jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode }; },
}));

import { AppBar } from '../../src/components/AppBar';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

afterEach(() => {
  mockApi.mode = 'preview';
});

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

describe('AppBar wordmark', () => {
  test('keeps the full preview wordmark on one line at the compact brand size', async () => {
    mockApi.mode = 'preview';
    await render(wrap(<AppBar role="student" onProfile={() => {}} />));

    const wordmark = screen.getByText('CampusUTE');
    expect(wordmark.props.numberOfLines).toBe(1);
    expect(screen.getByTestId('preview-pill')).toBeOnTheScreen();
  });

  test('keeps the signed-in wordmark on one line at the headline size', async () => {
    mockApi.mode = 'live';
    await render(wrap(<AppBar role="student" onProfile={() => {}} />));

    const wordmark = screen.getByText('CampusUTE');
    expect(wordmark.props.numberOfLines).toBe(1);
    expect(screen.queryByTestId('preview-pill')).toBeNull();
  });
});
