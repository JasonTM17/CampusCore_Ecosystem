// Ordering fence for lane reads. Every reload takes a token; only the newest
// token may write state, so a slow page or a stale focus refetch cannot replace
// the rows the staff member is looking at.

export interface RequestGate {
  begin: () => number;
  isLatest: (token: number) => boolean;
}

export function createRequestGate(): RequestGate {
  let latest = 0;
  return {
    begin: () => ++latest,
    isLatest: (token) => token === latest,
  };
}
