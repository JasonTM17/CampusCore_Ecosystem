import { cardRows as virtualCardRows } from '../../components/perf/virtual-rows';
import { tokens } from '../../design/tokens';

/** Separate content sections while retaining the continuous card's internal seams. */
export function cardRows<T>(...args: Parameters<typeof virtualCardRows<T>>) {
  const [prefix, data, key, header, render, options] = args;
  return virtualCardRows(prefix, data, key, header, render, {
    ...options,
    style: [{ marginBottom: tokens.spacing.sm }, options?.style],
  });
}
