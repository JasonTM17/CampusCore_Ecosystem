import { afterEach, expect, jest, test } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { LocaleProvider } from '../../src/i18n/locale-provider';

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]), useLocalSearchParams: () => ({}) };
});

import { useLaneRequest } from '../../src/screens/lanes/lane-ui';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const LocaleWrapper = ({ children }: { children: ReactNode }) => (
  <LocaleProvider initialLocale="en">{children}</LocaleProvider>
);

afterEach(() => {
  jest.clearAllMocks();
});

test('a late read for an older page never replaces the page the member has open', async () => {
  const pageZero = deferred<string>();
  const pageOne = deferred<string>();
  const reads: Record<number, ReturnType<typeof deferred<string>>> = { 0: pageZero, 1: pageOne };
  const fetchPage = jest.fn((page: number) => reads[page].promise);
  const view = await renderHook(
    ({ page }: { page: number }) => useLaneRequest(() => fetchPage(page), `desk:${page}`),
    { initialProps: { page: 0 }, wrapper: LocaleWrapper },
  );

  // Page 0 is still in flight when the member moves on; page 1 must start before either answer lands.
  view.rerender({ page: 1 });
  await waitFor(() => expect(fetchPage).toHaveBeenCalledWith(1));
  await act(async () => { pageOne.resolve('page one'); });
  await waitFor(() => expect(view.result.current.data).toBe('page one'));

  await act(async () => { pageZero.resolve('page zero'); await Promise.resolve(); });
  expect(view.result.current.data).toBe('page one');
});
