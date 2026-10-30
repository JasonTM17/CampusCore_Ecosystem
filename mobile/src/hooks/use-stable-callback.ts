import { useCallback, useLayoutEffect, useRef } from 'react';

/** Stable event prop for memoized rows; dispatches against the latest committed screen. */
export function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result): (...args: Args) => Result {
  const ref = useRef(callback);
  useLayoutEffect(() => { ref.current = callback; });
  return useCallback((...args: Args) => ref.current(...args), []);
}
