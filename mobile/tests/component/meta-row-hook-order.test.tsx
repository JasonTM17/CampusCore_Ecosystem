import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

jest.mock('../../src/design/theme', () => {
  const actual = jest.requireActual<typeof import('../../src/design/theme')>('../../src/design/theme');
  return { ...actual, useTheme: jest.fn(actual.useTheme) };
});
jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'preview' },
}));

import { ThemeProvider, useTheme } from '../../src/design/theme';
import { MetaRow } from '../../src/screens/content/content-ui';
import { DateLine } from '../../src/screens/thesis/thesis-ui';

const themeMock = useTheme as jest.MockedFunction<typeof useTheme>;
const wrap = (ui: ReactElement) => <ThemeProvider forcedScheme="light">{ui}</ThemeProvider>;

beforeEach(() => {
  themeMock.mockClear();
});

describe('optional detail rows', () => {
  test('MetaRow reads the theme before deciding whether to render a value', async () => {
    const view = await render(wrap(<MetaRow label="Reason" value={null} />));
    expect(themeMock).toHaveBeenCalled();
    expect(screen.queryByLabelText('Reason: Not suitable')).toBeNull();

    await view.rerender(wrap(<MetaRow label="Reason" value="Not suitable" />));
    expect(screen.getByLabelText('Reason: Not suitable')).toBeOnTheScreen();

    await view.rerender(wrap(<MetaRow label="Reason" value={null} />));
    expect(screen.queryByLabelText('Reason: Not suitable')).toBeNull();
  });

  test('DateLine reads the theme before deciding whether to render a value', async () => {
    const view = await render(wrap(<DateLine label="Defense" text={null} />));
    expect(themeMock).toHaveBeenCalled();
    expect(screen.queryByText('3 Nov 2026')).toBeNull();

    await view.rerender(wrap(<DateLine label="Defense" text="3 Nov 2026" />));
    expect(screen.getByText('3 Nov 2026')).toBeOnTheScreen();

    await view.rerender(wrap(<DateLine label="Defense" text={null} />));
    expect(screen.queryByText('3 Nov 2026')).toBeNull();
  });
});
