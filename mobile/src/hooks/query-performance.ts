export type ResourceClass = 'list' | 'detail' | 'static';

export const RESOURCE_STALE_TIME: Readonly<Record<ResourceClass, number>> = {
  list: 30_000, detail: 120_000, static: 900_000,
};

export function resourceStaleTime(key: string, resourceClass?: ResourceClass): number {
  if (/^(lane|dean|staff|admin)[.:]/.test(key)) return 0;
  const kind = resourceClass ?? (/semesters|curriculum|catalog/.test(key) ? 'static'
    : /detail|profile/.test(key) ? 'detail' : 'list');
  return RESOURCE_STALE_TIME[kind];
}

const pending = new Map<string, Promise<unknown>>();

/** Identity already includes account, locale, role, grants, resource and epoch. */
export function coalesceQueryRequest<T>(identity: string, request: () => Promise<T>): Promise<T> {
  const current = pending.get(identity);
  if (current) return current as Promise<T>;
  const promise = Promise.resolve().then(request);
  pending.set(identity, promise);
  const clear = () => { if (pending.get(identity) === promise) pending.delete(identity); };
  // Attach both handlers so rejection cleanup cannot create an unhandled promise.
  void promise.then(clear, clear);
  return promise;
}

export function canRevalidate(appState: unknown, focused = true): boolean {
  // Native state can be unavailable at boot. Only a reported state can pause a read.
  return focused && (typeof appState !== 'string' || appState === 'active');
}

/** Deferred, one-shot work. Cancellation before dispatch never calls the loader. */
export function schedulePrefetch<T>({ load, isCurrent, publish, delay = 150 }: {
  load: (signal: AbortSignal) => Promise<T>;
  isCurrent: () => boolean;
  publish: (data: T) => void;
  delay?: number;
}): () => void {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    if (controller.signal.aborted || !isCurrent()) return;
    void load(controller.signal).then((data) => {
      if (!controller.signal.aborted && isCurrent()) publish(data);
    }, () => { /* Speculative reads never change the visible error state. */ });
  }, delay);
  return () => { clearTimeout(timer); controller.abort(); };
}
