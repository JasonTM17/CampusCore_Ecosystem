import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { createApiClient } from '../../src/api/client';
import { clearQueryCache } from '../../src/hooks/query-cache';
import { useScreenQuery } from '../../src/hooks/useScreenQuery';

let mockEpoch = 1;
let mockSession = { accountId: 'student-1', role: 'student', capabilities: [] as string[] };
jest.mock('../../src/session/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../../src/i18n/locale-provider', () => ({ useLocale: () => ({ locale: 'vi' }) }));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: { sessionEpoch: () => mockEpoch } }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ isConnected: true }) }));

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  clearQueryCache();
  mockEpoch = 1;
  mockSession = { accountId: 'student-1', role: 'student', capabilities: [] };
});

describe('screen query recovery through the API client', () => {
  test.each(['network error', 'slow response'] as const)('%s becomes a retryable state and recovers', async (failure) => {
    let calls = 0;
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls > 1) {
        return Promise.resolve(new Response(JSON.stringify({ value: 'recovered' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      }
      if (failure === 'network error') return Promise.reject(new TypeError('network unavailable'));
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(new DOMException('request timed out', 'AbortError'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    }) as typeof fetch;

    const client = createApiClient({
      baseUrl: 'https://api.test/api/v1',
      mode: 'live',
      timeoutMs: 20,
      getAccessToken: () => 'access-token',
      sessionEpoch: () => mockEpoch,
    });
    const view = await renderHook(() => useScreenQuery('journey.retry', () => client.get<{ value: string }>('/journey')));

    const expectedStatus = failure === 'slow response' ? 408 : 0;
    await waitFor(() => expect(view.result.current.errorStatus).toBe(expectedStatus));
    expect(view.result.current.error).not.toBeNull();
    expect(view.result.current.data).toBeUndefined();

    await act(async () => view.result.current.reload());

    expect(view.result.current.error).toBeNull();
    expect(view.result.current.data).toEqual({ value: 'recovered' });
    expect(calls).toBe(2);
  });
});
