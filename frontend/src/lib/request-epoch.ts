/**
 * Monotonic request epoch for section loads: only the newest `begin()` result
 * may apply its response, and `invalidate()` retires everything in flight at
 * unmount. Kept free of React so the ordering contract is unit-testable.
 */
export type RequestEpoch = {
  begin: () => number;
  isCurrent: (epoch: number) => boolean;
  invalidate: () => void;
};

export function createRequestEpoch(): RequestEpoch {
  let current = 0;
  return {
    begin() {
      return ++current;
    },
    isCurrent(epoch) {
      return epoch > 0 && epoch === current;
    },
    invalidate() {
      current += 1;
    },
  };
}
