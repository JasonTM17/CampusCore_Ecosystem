import { useCallback, useMemo, useState } from 'react';

/** Visible overlay only: a rejected write reveals the untouched read model. */
export function useOptimisticRows<T>(items: readonly T[], identity: string) {
  const [pending, setPending] = useState<{ identity: string; token: object; transform: (row: T) => T | null } | null>(null);
  const begin = useCallback((transform: (row: T) => T | null) => {
    const token = {};
    setPending({ identity, token, transform });
    return () => setPending((current) => current?.token === token ? null : current);
  }, [identity]);
  const rows = useMemo(() => pending?.identity === identity
    ? items.flatMap((row) => { const next = pending.transform(row); return next === null ? [] : [next]; })
    : items, [identity, items, pending]);
  return { rows, begin };
}
