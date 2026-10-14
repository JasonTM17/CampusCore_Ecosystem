import { createRequestId } from '@/lib/api';

export type SessionChangeKind = 'changed' | 'signed-out';

interface SessionChangePayload {
  revision: string;
  source: string;
  kind: SessionChangeKind;
}

const STORAGE_KEY = 'campuscore-session-revision';
const CHANNEL_NAME = 'campuscore-session-events';
const MAX_SEEN_REVISIONS = 32;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let documentSource: string | null = null;

function documentSourceId(): string {
  if (!documentSource) {
    documentSource = createRequestId();
  }
  return documentSource;
}

function parsePayload(raw: unknown): SessionChangePayload | null {
  let candidate = raw;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  const keys = Object.keys(candidate).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'kind' ||
    keys[1] !== 'revision' ||
    keys[2] !== 'source'
  ) {
    return null;
  }
  const { revision, source, kind } = candidate as {
    revision: unknown;
    source: unknown;
    kind: unknown;
  };
  if (typeof revision !== 'string' || !UUID_PATTERN.test(revision)) {
    return null;
  }
  if (typeof source !== 'string' || !UUID_PATTERN.test(source)) {
    return null;
  }
  if (kind !== 'changed' && kind !== 'signed-out') {
    return null;
  }
  return { revision, source, kind };
}

function readStoredMarker(): { ok: boolean; raw: string | null } {
  try {
    return { ok: true, raw: window.localStorage.getItem(STORAGE_KEY) };
  } catch {
    return { ok: false, raw: null };
  }
}

function storageWritable(source: string): boolean {
  const probeKey = `${STORAGE_KEY}:probe:${source}`;
  try {
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

export function publishSessionChange(kind: SessionChangeKind): void {
  if (typeof window === 'undefined') {
    return;
  }
  const payload: SessionChangePayload = {
    revision: createRequestId(),
    source: documentSourceId(),
    kind,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
  if (typeof BroadcastChannel !== 'function') {
    return;
  }
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    try {
      channel.postMessage(payload);
    } finally {
      channel.close();
    }
  } catch {}
}

export function subscribeSessionChanges(
  listener: (kind: SessionChangeKind) => void,
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  const source = documentSourceId();
  const seen = new Set<string>();
  const seenOrder: string[] = [];

  const remember = (revision: string) => {
    if (seen.has(revision)) {
      return;
    }
    seen.add(revision);
    seenOrder.push(revision);
    while (seenOrder.length > MAX_SEEN_REVISIONS) {
      const oldest = seenOrder.shift();
      if (oldest !== undefined) {
        seen.delete(oldest);
      }
    }
  };

  const apply = (raw: unknown) => {
    const payload = parsePayload(raw);
    if (!payload || payload.source === source || seen.has(payload.revision)) {
      return;
    }
    remember(payload.revision);
    listener(payload.kind);
  };

  const resyncFromStorage = () => {
    if (!storageWritable(source)) {
      listener('changed');
      return;
    }
    const { ok, raw } = readStoredMarker();
    if (!ok) {
      listener('changed');
      return;
    }
    if (raw !== null) {
      apply(raw);
    }
  };

  const initial = readStoredMarker();
  if (initial.ok && initial.raw !== null) {
    const payload = parsePayload(initial.raw);
    if (payload) {
      remember(payload.revision);
    }
  }

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel === 'function') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent) => {
        apply(event.data);
      };
    } catch {
      channel = null;
    }
  }

  let windowBlurred =
    typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
  let documentHidden = document.visibilityState === 'hidden';

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || event.newValue === null) {
      return;
    }
    apply(event.newValue);
  };
  const onBlur = () => {
    windowBlurred = true;
  };
  const onFocus = () => {
    if (!windowBlurred) {
      return;
    }
    windowBlurred = false;
    resyncFromStorage();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      documentHidden = true;
      return;
    }
    if (!documentHidden) {
      return;
    }
    documentHidden = false;
    resyncFromStorage();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) {
      return;
    }
    if (storageWritable(source)) {
      const { ok, raw } = readStoredMarker();
      if (ok && raw !== null) {
        const payload = parsePayload(raw);
        if (payload && payload.source !== source && !seen.has(payload.revision)) {
          apply(raw);
          return;
        }
      }
    }
    listener('changed');
  };

  window.addEventListener('storage', onStorage);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibility);
    if (channel) {
      try {
        channel.close();
      } catch {}
      channel = null;
    }
  };
}
